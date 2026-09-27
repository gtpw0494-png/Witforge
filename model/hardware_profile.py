#!/usr/bin/env python3
import json,os,platform
try:import torch
except Exception:torch=None

def ram_bytes():
 try:return os.sysconf('SC_PAGE_SIZE')*os.sysconf('SC_PHYS_PAGES')
 except Exception:return None
ram=ram_bytes();cuda=bool(torch and torch.cuda.is_available());gpu=None
if cuda:
 try:gpu={'name':torch.cuda.get_device_name(0),'memoryBytes':torch.cuda.get_device_properties(0).total_memory}
 except Exception:gpu={'name':'CUDA device','memoryBytes':None}
# These are compatibility tiers, not speed/performance guarantees.
tiers=['termux-tiny']
if ram and ram>=4*1024**3:tiers+=['termux-moe-lab','termux-future-lab']
if ram and ram>=12*1024**3:tiers+=['desktop-small']
if ram and ram>=20*1024**3:tiers+=['desktop-moe']
out={'state':'SUCCESS','platform':platform.platform(),'machine':platform.machine(),'cpuCount':os.cpu_count(),'ramBytes':ram,'torch':getattr(torch,'__version__',None),'cuda':cuda,'gpu':gpu,'compatiblePresetCandidates':tiers,'truth':'Candidates are conservative memory-oriented starting points, not benchmark or quality claims.'}
print(json.dumps(out))
