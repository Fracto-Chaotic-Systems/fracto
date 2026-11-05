import fs from 'node:fs'
import path from 'node:path'
import {pipeline} from 'node:stream/promises'
import {createGzip} from 'node:zlib'

const glob = pattern => {
   let expression = ''
   for (let index = 0; index < pattern.length; index++) {
      const character = pattern[index]
      if (character === '*' && pattern[index + 1] === '*') {
         index++
         if (pattern[index + 1] === '/') { expression += '(?:.*/)?'; index++ }
         else expression += '.*'
      } else if (character === '*') expression += '[^/]*'
      else if (character === '?') expression += '[^/]'
      else expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
   }
   return new RegExp(`^${expression}(?:/.*)?$`)
}

// Support this project's ignore patterns; refuse unsupported syntax rather than
// silently package something Docker would exclude. Directory reinclusion needs
// explicit support before adding another negated rule to .dockerignore.
export const context_filter = source => {
   const rules = source.replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
      const pattern = line.trim()
      if (!pattern || pattern.startsWith('#') || pattern === '.') return []
      const include = pattern.startsWith('!')
      if ((include && pattern !== '!**/.env.example') || /[\[\]\\]/.test(pattern))
         throw new Error(`Unsupported .dockerignore pattern: ${pattern}`)
      const normalized = (include ? pattern.slice(1) : pattern).replace(/^\/+|\/+$/g, '')
      if (normalized.split('/').includes('..')) throw new Error('Unsafe .dockerignore pattern')
      return [{include, matches: glob(normalized)}]
   })
   return relative => {
      let included = true
      for (const rule of rules) if (rule.matches.test(relative)) included = rule.include
      return included
   }
}

export const context_files = root => {
   const included = context_filter(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8'))
   const files = []
   const visit = relative => {
      const entries = fs.readdirSync(path.join(root, relative), {withFileTypes: true})
         .sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
         const child = relative ? `${relative}/${entry.name}` : entry.name
         if (!included(child)) continue
         if (entry.isSymbolicLink()) throw new Error(`Build context contains a link: ${child}`)
         if (entry.isDirectory()) visit(child)
         else if (entry.isFile()) files.push(child)
         else throw new Error(`Unsupported build context entry: ${child}`)
      }
   }
   visit('')
   return files
}

const field = (header, value, offset, length) => {
   if (Buffer.byteLength(value) > length) throw new Error('Build context exceeds USTAR path/size limits')
   header.write(value, offset, length, 'utf8')
}
const octal = (header, value, offset, length) =>
   field(header, value.toString(8).padStart(length - 1, '0') + '\0', offset, length)

const header_for = (relative, stat) => {
   const header = Buffer.alloc(512)
   let name = relative, prefix = ''
   if (Buffer.byteLength(name) > 100) {
      const split = name.lastIndexOf('/')
      if (split < 0) throw new Error('Build context filename exceeds USTAR limits')
      prefix = name.slice(0, split)
      name = name.slice(split + 1)
   }
   field(header, name, 0, 100)
   octal(header, stat.mode & 0o777, 100, 8)
   octal(header, 0, 108, 8)
   octal(header, 0, 116, 8)
   octal(header, stat.size, 124, 12)
   octal(header, Math.floor(stat.mtimeMs / 1000), 136, 12)
   header.fill(32, 148, 156)
   header[156] = 48
   field(header, 'ustar\0', 257, 6)
   field(header, '00', 263, 2)
   field(header, prefix, 345, 155)
   const checksum = header.reduce((sum, value) => sum + value, 0)
   field(header, checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
   return header
}

export const create_context_archive = async (root, destination) => {
   root = path.resolve(root)
   const relative_destination = path.relative(root, path.resolve(destination))
   if (!relative_destination.startsWith(`..${path.sep}`) && !path.isAbsolute(relative_destination))
      throw new Error('Build context archive must be outside the source checkout')
   const files = context_files(root)
   async function* contents() {
      for (const relative of files) {
         const filename = path.join(root, relative)
         const before = fs.lstatSync(filename)
         if (!before.isFile() || before.isSymbolicLink()) throw new Error('Build input changed type')
         yield header_for(relative, before)
         let bytes = 0
         for await (const chunk of fs.createReadStream(filename)) { bytes += chunk.length; yield chunk }
         const after = fs.lstatSync(filename)
         if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
            throw new Error(`Build input changed during packaging: ${relative}`)
         const padding = (512 - before.size % 512) % 512
         if (padding) yield Buffer.alloc(padding)
      }
      yield Buffer.alloc(1024)
   }
   await pipeline(contents(), createGzip(), fs.createWriteStream(destination, {flags: 'wx', mode: 0o600}))
   return {files: files.length, bytes: fs.statSync(destination).size}
}
