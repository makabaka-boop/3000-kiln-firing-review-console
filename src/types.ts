export type Recipe={id:string;name:string;target:number;tolerance:number;duration:number};
export type Sample={time:string;temperature:number};
export type AnomalyStatus='pending'|'equipment'|'process'|'accepted';
export type Review={status:AnomalyStatus;note:string};
export type Batch={id:string;name:string;kiln:string;recipeId:string;start:string;notes:string;samples:Sample[];reviews:Record<string,Review>;referenceBatchId?:string;gapMinutesOverride?:number};
export type Store={version:1;gapMinutes:number;recipes:Recipe[];batches:Batch[]};
