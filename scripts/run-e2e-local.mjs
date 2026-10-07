import { spawn } from "node:child_process";
import process from "node:process";

const port=Number(process.env.PORT||4173);
const server=spawn(process.execPath,["scripts/static-server.mjs"],{stdio:["ignore","inherit","inherit"],env:{...process.env,PORT:String(port)}});

function stop(code){
  if(!server.killed)server.kill("SIGTERM");
  process.exitCode=code;
}

const onSignal=()=>stop(1);
process.once("SIGINT",onSignal);
process.once("SIGTERM",onSignal);

try{
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(resolve,1000);
    server.once("error",err=>{clearTimeout(timer);reject(err);});
    server.once("exit",(code)=>{
      clearTimeout(timer);
      if(code!==null&&code!==0)reject(new Error("Static server exited before E2E tests started."));
    });
  });
  const result=await new Promise(resolve=>{
    const test=spawn(process.execPath,["--test","tests/e2e/selenium/tests"],{stdio:"inherit",env:{...process.env,E2E_BASE_URL:process.env.E2E_BASE_URL||`http://127.0.0.1:${port}`}});
    test.on("exit",(code,signal)=>resolve(code??(signal?1:0)));
    test.on("error",()=>resolve(1));
  });
  stop(result);
}catch(error){
  console.error(error.message);
  stop(1);
}
