// Run with the documented CUA tab/browser handles. Never creates a browser or production data.
// const proof = await import('/absolute/repo/scripts/terminal/prove-browser.mjs');
// const result = await proof.proveBrowser(tab, browser);
export async function proveBrowser(tab,browser,{download=true}={}){
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 const results=[];const pw=tab.playwright;
 await pw.getByRole('button',{name:'All games',exact:true}).click();
 await pw.getByRole('button',{name:'ALL',exact:true}).click();
 await pw.getByRole('textbox',{name:'Search teams or league'}).fill('');
 await pw.getByRole('combobox',{name:'Game window'}).selectOption('192');
 await pw.getByRole('combobox',{name:'Sort games'}).selectOption('start');
 const first=pw.getByRole('button',{name:/^Inspect /}).first();
 const label=await first.getAttribute('aria-label');check(label,'Real upcoming game required');
 const gameName=label.replace(/^Inspect /,'');
 await first.click();
 check(await pw.getByRole('heading',{name:gameName,exact:true}).isVisible(),'Selection');results.push('real game selection');
 const add=pw.getByRole('button',{name:'☆ Add to shortlist',exact:true});
 const added=await add.isVisible();
 if(added)await add.click();
 try{
  await tab.reload();
  await pw.getByRole('button',{name:'★ Saved to shortlist',exact:true}).waitFor({state:'visible',timeoutMs:15000});
  check(await pw.getByRole('heading',{name:gameName,exact:true}).isVisible(),'Selected game survives reload');
  results.push('shortlist and selected identity survive reload');
  await pw.getByRole('textbox',{name:'Search teams or league'}).fill(gameName.split(' at ')[0]);
  check(await pw.getByRole('button',{name:label,exact:true}).isVisible(),'Search retains matching team');
  await pw.getByRole('textbox',{name:'Search teams or league'}).fill('no-such-team-terminal-proof');
  check(await pw.getByRole('heading',{name:'No games match this view',exact:true}).isVisible(),'Honest empty state');
  await pw.getByRole('textbox',{name:'Search teams or league'}).fill('');results.push('search and empty state');
  await pw.getByRole('combobox',{name:'Sort games'}).selectOption('price');
  check(await pw.getByRole('columnheader',{name:'Market EV*',exact:true}).isVisible(),'Sort metric visible');
  await pw.getByRole('combobox',{name:'Sort games'}).selectOption('start');results.push('sort metric matches displayed column');
  await pw.getByRole('tab',{name:'Prices',exact:true}).click();
  check((await pw.getByRole('tabpanel').innerText()).includes('source event identity is missing'),'Unverified odds visibly withheld');
  await pw.getByRole('tab',{name:'Record',exact:true}).click();
  check((await pw.getByRole('tabpanel').innerText()).includes('Pregame collection is not enabled'),'Collection off');results.push('price provenance and disabled measurement');
  await pw.getByRole('tab',{name:'Research',exact:true}).click();
  await pw.getByRole('button',{name:'↻ Refresh',exact:true}).click();
  await pw.getByRole('status').filter({hasText:'Latest available'}).waitFor({state:'visible',timeoutMs:15000});results.push('source refresh');
  if(download){const [receipt]=await Promise.all([pw.waitForEvent('download',{timeoutMs:15000}),pw.getByRole('button',{name:'Export research ↓',exact:true}).click()]);check(await receipt.path({timeoutMs:15000}),'Native file receipt');results.push('native evidence attachment');}
  const viewport=await browser.capabilities.get('viewport');
  try{await viewport.set({width:390,height:844});check(await pw.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile page overflow');results.push('390px mobile without page overflow');}finally{await viewport.reset();}
 }finally{if(added&&await pw.getByRole('button',{name:'★ Saved to shortlist',exact:true}).isVisible())await pw.getByRole('button',{name:'★ Saved to shortlist',exact:true}).click();}
 check(!(await tab.dev.logs({levels:['error'],limit:20})).length,'Browser errors');results.push('no browser console errors');
 return {checkedAt:new Date().toISOString(),url:await tab.url(),game:gameName,downloadChecked:download,passed:results};
}
