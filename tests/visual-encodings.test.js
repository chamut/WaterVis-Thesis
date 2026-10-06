import test from 'node:test';
import assert from 'node:assert/strict';
import {observationStatus} from '../src/visual-encodings.js';

test('observations use both ERS bounds and keep missing objectives distinct',()=>{
  const range={lower:75,upper:130};
  assert.equal(observationStatus(74.9,range),'outside');
  assert.equal(observationStatus(130.1,range),'outside');
  assert.equal(observationStatus(75,range),'within');
  assert.equal(observationStatus(130,range),'within');
  assert.equal(observationStatus(2,{upper:1}),'outside');
  assert.equal(observationStatus(2,{lower:1}),'within');
  assert.equal(observationStatus(2,null),'unavailable');
  assert.equal(observationStatus(2,{}),'unavailable');
});
