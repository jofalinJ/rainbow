import {build} from 'esbuild';
await build({entryPoints:['src/biometrics/face-liveness.jsx'],bundle:true,format:'esm',platform:'browser',target:['chrome110'],
  outfile:'dist/face-liveness.js',minify:true,legalComments:'linked',define:{'process.env.NODE_ENV':'"production"'}});
console.log('Built genuine AWS face liveness camera component.');
