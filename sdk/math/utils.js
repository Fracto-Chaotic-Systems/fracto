export const farey_sequence = (n) => {
   let seq = [[0, 1], [1, 2]];
   for (let i = 2; i <= n; i++) {
      if (i % 100 === 0) {
         console.log(i)
      }
      for (let j = 0; j < seq.length - 1; j++) {
         let [p1, q1] = seq[j];
         let [p2, q2] = seq[j + 1];
         if (q1 + q2 === i) {
            seq.splice(j + 1, 0, [p1 + p2, q1 + q2]);
            j++;
         }
      }
   }
   const all_seq = seq
      .map(f => {
         return `${f[0]},${f[1]},${f[0] / f[1]}`
      })
   all_seq.unshift('num,den,ratio')
   return all_seq
}
