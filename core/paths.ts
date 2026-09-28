import path from 'node:path';
let root=process.env.DECLGEN_DATA_ROOT || path.resolve(process.cwd(),'declgen-data');
export function setDataRoot(v:string){root=path.resolve(v)}
export function dataRoot(){return root}
export function catalogDir(){return path.join(root,'catalog')}
export function clientsDir(){return path.join(root,'clients')}
export function runsDir(){return path.join(root,'runs')}
