window.RainbowBillPdf=(()=>{
  async function waitForRender(){
    if(document.fonts?.ready)await document.fonts.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  }
  function bufferToBase64(buffer){
    const bytes=new Uint8Array(buffer);let binary="";
    for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return btoa(binary);
  }
  async function fromData(data,target){
    if(!window.html2canvas||!window.jspdf?.jsPDF)throw new Error("PDF tools did not load. Refresh the page.");
    RainbowInvoice.render(data,target);
    await waitForRender();
    const canvas=await html2canvas(target,{scale:2.2,useCORS:true,backgroundColor:"#ffffff",logging:false});
    const imageWidth=72;
    const imageHeight=canvas.height/canvas.width*imageWidth;
    const pageHeight=Math.max(90,imageHeight+8);
    const pdf=new window.jspdf.jsPDF({orientation:"portrait",unit:"mm",format:[80,pageHeight],compress:true});
    pdf.addImage(canvas.toDataURL("image/jpeg",0.94),"JPEG",4,4,imageWidth,imageHeight,undefined,"FAST");
    return pdf;
  }
  return {fromData,bufferToBase64};
})();