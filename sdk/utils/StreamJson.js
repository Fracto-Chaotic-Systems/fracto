import fs from 'fs';
import {chain}  from 'stream-chain'
import { parser } from 'stream-json';
import Assembler from 'stream-json/Assembler.js';

export const stream_json = (filepath, cb) => {
   const pipeline = chain([
      fs.createReadStream(filepath),
      parser()
   ]);
   const asm = Assembler.connectTo(pipeline);
   asm.on('done', (result) => {
      console.log('Parsed Object:', result.current);
      cb(result.current)
   });
   pipeline.on('error', (err) => {
      console.error('Parsing error:', err);
      cb({error: err})
   });
}

