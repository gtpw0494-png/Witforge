'use strict';
const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');const {MentalHealthService}=require('./mental-health.js');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'witforge-mh-'));const mh=new MentalHealthService({root});
assert.equal(mh.status().consent,false);assert.equal(mh.status().trainingEligible,false);assert.equal(mh.screen({phq9:Array(9).fill(0),gad7:Array(7).fill(0)}).state,'BLOCKED');
mh.setConsent(true);const r=mh.screen({phq9:[0,1,0,1,0,1,0,0,0],gad7:[0,1,0,1,0,1,0]});assert.equal(r.state,'SUCCESS');assert.equal(r.notDiagnosis,true);assert.equal(r.trainingEligible,false);assert.equal(mh.support({role:'psychiatry-support',message:'test'}).state,'SUCCESS');
assert.equal(mh.deleteAll('wrong').state,'DENIED');assert.equal(mh.deleteAll('DELETE MENTAL HEALTH DATA').state,'SUCCESS');console.log('mental-health tests passed');