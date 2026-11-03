// eqosys's tools for an agent in the browser. This is the page's only other script (the CSP names it by hash, like the sky switch's).
// It asks GET /api/tools what exists, registers each as a WebMCP tool (document.modelContext, or navigator's on earlier builds) that
// POSTs /api/tools/<name> with the person's own session, and adds eq_open_app, which only a page can do. Nothing holds a token.
// It also hangs window.__commands {list, run} so `bun run probe eqosys --js "__commands.list()"` and tests see the same set.
// Plain ES5-ish text so its hash is stable.

export const WEBMCP_SCRIPT = `(function(){var d=document,w=window,mc=d.modelContext||navigator.modelContext,cmds={};
function call(name,args){return fetch("/api/tools/"+name,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify(args||{})})
.then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error((j&&j.error)||("eqosys answered "+r.status+(r.status===401?": sign in first":"")));return j.result})})}
function add(t){cmds[t.name]=t;if(!mc)return;try{var p=mc.registerTool({name:t.name,title:t.title,description:t.description,inputSchema:t.inputSchema,annotations:t.annotations,execute:function(a){return t.execute(a)}});if(p&&p.catch)p.catch(function(){})}catch(e){}}
w.__commands={list:function(){return Object.keys(cmds).map(function(k){var t=cmds[k];return{name:t.name,title:t.title,description:t.description,input:t.inputSchema,readOnly:!!(t.annotations&&t.annotations.readOnlyHint)}})},
run:function(n,a){if(!cmds[n])return Promise.reject(new Error("no command "+n+": "+Object.keys(cmds).join(", ")));return Promise.resolve(cmds[n].execute(a||{}))}};
add({name:"eq_open_app",title:"Open an app's page",description:"Go to an app's page here (its long description, achievements and Play button) by id from eq_apps. Answers once navigation starts.",
inputSchema:{type:"object",properties:{app:{type:"string"}},required:["app"],additionalProperties:false},annotations:{readOnlyHint:false,idempotentHint:true},
execute:function(a){if(!a||typeof a.app!=="string"||!/^[a-z0-9-]+$/.test(a.app))throw new Error("send { app: an id from eq_apps }");setTimeout(function(){location.assign("/app/"+a.app)},0);return{opening:a.app}}});
fetch("/api/tools",{credentials:"same-origin"}).then(function(r){return r.ok?r.json():{tools:[]}}).then(function(j){(j.tools||[]).forEach(function(t){t.execute=function(a){return call(t.name,a)};add(t)})}).catch(function(){})})();`;
