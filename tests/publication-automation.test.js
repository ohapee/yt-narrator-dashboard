import test from 'node:test';
import assert from 'node:assert/strict';
import {ensurePublicHosting} from '../scripts/publication-automation.mjs';

function services(inspection, status = [false,true]) {
 const events=[];return {events,configured:async()=>{events.push('configured');return status.shift();},inspectBucket:async()=>{events.push('inspect');return inspection;},createBucket:async()=>{events.push('create');},deploy:async()=>{events.push('deploy');}};
}
test('R2 subscription must be enabled externally; waiting does not create or deploy',async()=>{
 const operations=services('r2_disabled');assert.deepEqual(await ensurePublicHosting(operations),{status:'waiting_for_r2',provisioned:false});assert.deepEqual(operations.events,['configured','inspect']);
});
test('enabling R2 leads to bucket creation, deployment and API verification in order',async()=>{
 const operations=services('missing');assert.deepEqual(await ensurePublicHosting(operations),{status:'ready',provisioned:true});assert.deepEqual(operations.events,['configured','inspect','create','deploy','configured']);
});
test('an existing bucket is preserved and a ready service does not redeploy every cycle',async()=>{
 const existing=services('exists');await ensurePublicHosting(existing);assert.deepEqual(existing.events,['configured','inspect','deploy','configured']);
 const ready=services('exists',[true]);assert.deepEqual(await ensurePublicHosting(ready),{status:'ready',provisioned:false});assert.deepEqual(ready.events,['configured']);
});
test('failed setup or verification cannot start the publishing phase',async()=>{
 const failure=services('missing');failure.createBucket=async()=>{throw new Error('permission denied');};await assert.rejects(ensurePublicHosting(failure),/permission denied/);assert.ok(!failure.events.includes('deploy'));
 const unverified=services('exists',[false,false]);await assert.rejects(ensurePublicHosting(unverified),/デプロイ後/);
});
