'use strict';
const {createBridge}=require('../../ShootingOperationsPackages/JsoChartEditor/bridge.cjs');
// Loaded by the existing ToolBox service-plugin router. General API Bearer
// authentication is inherited; the JSO credential is verified independently.
function registerApiRoutes(router,config){
 const bridge=createBridge({endpoint:config.JSO_LOCAL_AGENT_ENDPOINT,resources:String(config.JSO_RESOURCE_IDS||'').split(',').map(s=>s.trim()).filter(Boolean)});
 for(const action of ['snapshot','preview','apply','recover'])router.post('/'+action,async(req,res)=>{
  res.setHeader('cache-control','no-store');
  if(JSON.stringify(req.body??{}).length>32768)return res.status(413).json({ok:false,code:'CHART_REQUEST_TOO_LARGE'});
  const result=await bridge.run(action,req.body,req.headers['x-vcp-application-authorization']);res.json(result);
 });
}
module.exports={registerApiRoutes};
