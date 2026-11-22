import {featureText} from '../features/bundle.js';
import {EXECUTION_LIMITS} from './model.js';

export function executionInteractionText(value:unknown){
 const text=featureText(value,EXECUTION_LIMITS.interactionBytes,true);
 if(!text.trim()||/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(text))throw new Error('INVALID_REQUEST');
 return text;
}
