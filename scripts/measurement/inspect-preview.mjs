#!/usr/bin/env node
import {previewDeployment} from './http-target.mjs';
console.log(JSON.stringify(await previewDeployment(),null,2));
