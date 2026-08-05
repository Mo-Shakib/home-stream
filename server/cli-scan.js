import { scanLibraries } from './scanner.js';
const result = await scanLibraries();
console.log(JSON.stringify(result, null, 2));
