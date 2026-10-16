import test from 'node:test';
import assert from 'node:assert/strict';
import { newDemoAuction, demoAuctionStep as step, DEMO_TURN_MS } from '../lib/demo-auction.ts';
test('queued buyer keeps click price and receives a fresh full turn after preceding expiry', () => {
 let s = step(newDemoAuction(0), {type:'tick',now:13000},999);
 s = step(s,{type:'join',now:20000},999);
 const price = s.buyers[1].price;
 assert.equal(s.buyers[1].claimedAt,null);
 s = step(s,{type:'tick',now:133000},999);
 assert.equal(s.buyers[0].id,'you');
 assert.equal(s.buyers[0].claimedAt,133000);
 assert.equal(s.buyers[0].price,price);
 s = step(s,{type:'pay',code:'123456',now:252999},999);
 assert.equal(s.outcome,'won');
 assert.equal(s.soldPrice,price);
});
test('payment at exact deadline fails and duplicate clicks do not duplicate buyers',()=>{
 let s=step(newDemoAuction(0),{type:'join',now:5000},999);
 s=step(s,{type:'join',now:5001},999);
 assert.equal(s.buyers.length,1);
 assert.equal(step(s,{type:'pay',now:5000+DEMO_TURN_MS,code:'123456'},999).outcome,'lost');
 assert.equal(step(s,{type:'pay',now:6000,code:'12345'},999).outcome,null);
});
test('simulation shortcut promotes one person without consuming the next turn',()=>{
 let s=step(newDemoAuction(0),{type:'tick',now:13000},999);
 s=step(s,{type:'join',now:15000},999);
 s=step(s,{type:'skip',now:16000},999);
 assert.equal(s.buyers[0].id,'you');
 assert.equal(s.buyers[0].claimedAt,16000);
 assert.equal(step(s,{type:'skip',now:17000},999).buyers[0].claimedAt,16000);
});

test('any six ASCII digits including leading zeroes work only during own turn',()=>{
 for(const code of ['000000','654321','012345','999999']) {
  const s=step(newDemoAuction(0),{type:'join',now:5000},999);
  assert.equal(step(s,{type:'pay',now:6000,code},999).outcome,'won');
 }
 for(const code of ['12345','1234567','abcdef','123 45']) {
  const s=step(newDemoAuction(0),{type:'join',now:5000},999);
  assert.equal(step(s,{type:'pay',now:6000,code},999).outcome,null);
 }
 let s=step(newDemoAuction(0),{type:'tick',now:13000},999);
 s=step(s,{type:'join',now:14000},999);
 assert.equal(step(s,{type:'pay',now:15000,code:'654321'},999).outcome,null);
});
