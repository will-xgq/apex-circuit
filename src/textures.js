// Retry a dropped local transfer, including failures while reading the response body.
export async function readAsset(url,type='blob') {
  for(let attempt=0;attempt<3;attempt++) {
    let status=0;
    try {
      const response=await fetch(url,{cache:attempt?'reload':'default'});
      status=response.status;
      if(!response.ok) throw new Error('HTTP '+status);
      return await response[type]();
    } catch(error) {
      if(attempt===2 || (status>=400 && status<500 && status!==408 && status!==429))
        throw new Error('无法加载 '+url.pathname.split('/').pop()+'（'+error.message+'）');
      await new Promise(resolve=>setTimeout(resolve,160*(attempt+1)));
    }
  }
}

export async function createMipmappedTexture(device, blob, fallback, srgb=false) {
  const format=srgb?'rgba8unorm-srgb':'rgba8unorm';
  const bitmap=blob?await createImageBitmap(blob):null;
  const width=bitmap?.width||1, height=bitmap?.height||1;
  const mipLevelCount=1+Math.floor(Math.log2(Math.max(width,height)));
  const result=device.createTexture({size:[width,height],format,mipLevelCount,
    usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
  if (!bitmap) {
    device.queue.writeTexture({texture:result},new Uint8Array(fallback),{},[1,1]);
    return result.createView();
  }
  device.queue.copyExternalImageToTexture({source:bitmap},{texture:result},[width,height]);
  const canvas=document.createElement('canvas');
  const ctx=canvas.getContext('2d');
  for(let level=1;level<mipLevelCount;level++) {
    canvas.width=Math.max(1,width>>level);
    canvas.height=Math.max(1,height>>level);
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    device.queue.copyExternalImageToTexture({source:canvas},{texture:result,mipLevel:level},[canvas.width,canvas.height]);
  }
  bitmap.close();
  return result.createView();
}
