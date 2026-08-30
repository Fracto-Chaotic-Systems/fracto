export const ANSI_COLOR_CODES = {
   30: '#000000', 31: '#ff5555', 32: '#50fa7b', 33: '#d4a72c',
   34: '#6272a4', 35: '#ff79c6', 36: '#8be9fd', 37: '#f8f8f2',
   90: '#6272a4', 91: '#ff6e6e', 92: '#69ff94', 93: '#ffffa5',
   94: '#d6acff', 95: '#ff92df', 96: '#a4ffff', 97: '#ffffff',
}

export const color_shortcode = short_code => `\u001B[38;2;58;150;221m${short_code}\u001B[39m`

export const ansi_segments = message => {
   const segments = []
   let current_color = null
   let cursor = 0
   let has_color = false
   const pattern = /\u001B\[([0-9;]*)m/g
   let match
   while ((match = pattern.exec(message))) {
      has_color = true
      if (match.index > cursor) segments.push({
         text: message.slice(cursor, match.index),
         color: current_color,
      })
      const codes = match[1].split(';').map(code => Number(code || 0))
      for (let code_index = 0; code_index < codes.length; code_index++) {
         const numeric_code = codes[code_index]
         if (numeric_code === 0 || numeric_code === 39) current_color = null
         else if (ANSI_COLOR_CODES[numeric_code]) current_color = ANSI_COLOR_CODES[numeric_code]
         else if (numeric_code === 38 && codes[code_index + 1] === 2) {
            const [red, green, blue] = codes.slice(code_index + 2, code_index + 5)
            current_color = `rgb(${red}, ${green}, ${blue})`
            code_index += 4
         }
      }
      cursor = pattern.lastIndex
   }
   if (cursor < message.length) segments.push({text: message.slice(cursor), color: current_color})
   return has_color ? segments.filter(segment => segment.text) : []
}
