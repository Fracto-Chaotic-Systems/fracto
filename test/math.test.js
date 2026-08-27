import assert from 'node:assert/strict'
import {describe, it} from 'node:test'

import BigComplex from '../sdk/math/BigComplex.js'
import Complex from '../sdk/math/Complex.js'
import HyperComplex from '../sdk/math/HyperComplex.js'
import {farey_sequence} from '../sdk/math/utils.js'

describe('Complex', () => {
   it('calculates magnitude and immutable arithmetic', () => {
      const value = new Complex(3, 4)
      assert.equal(value.magnitude(), 5)
      const sum = value.add(new Complex(2, -1))
      const product = value.mul(new Complex(2, -1))
      assert.deepEqual([sum.re, sum.im], [5, 3])
      assert.deepEqual([product.re, product.im], [10, 5])
      assert.deepEqual([value.re, value.im], [3, 4])
   })

   it('advances a Mandelbrot orbit in place', () => {
      const point = new Complex(0, 0)
      const parameter = new Complex(1, 0)
      assert.equal(point.mandelbrot(parameter), point)
      assert.deepEqual([point.re, point.im], [1, 0])
      point.mandelbrot(parameter)
      assert.deepEqual([point.re, point.im], [2, 0])
   })

   it('computes powers using polar coordinates', () => {
      const squared = new Complex(1, 1).pow(2)
      assert.ok(Math.abs(squared.re) < 1e-12)
      assert.ok(Math.abs(squared.im - 2) < 1e-12)
   })
})

describe('BigComplex', () => {
   it('preserves decimal precision in arithmetic', () => {
      const result = new BigComplex('0.1', '0.2').add(new BigComplex('0.2', '0.3'))
      assert.equal(result.re.toString(), '0.3')
      assert.equal(result.im.toString(), '0.5')
   })

   it('calculates a high-precision magnitude', () => {
      assert.equal(new BigComplex(3, 4).magnitude().toString(), '5')
   })
})

describe('HyperComplex', () => {
   it('retains its four components', () => {
      const value = new HyperComplex(1, 2, 3, 4)
      assert.equal(value.re, 1)
      assert.equal(value.im, 2)
      assert.equal(value.hn, 3)
      assert.equal(value.hc, 4)
   })
})

describe('farey_sequence', () => {
   it('generates the ordered sequence through the requested denominator', () => {
      assert.deepEqual(farey_sequence(5), [
         'num,den,ratio', '0,1,0', '1,5,0.2', '1,4,0.25',
         '1,3,0.3333333333333333', '2,5,0.4', '1,2,0.5',
      ])
   })
})
