import { put, list, del } from '@vercel/blob';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
const MAX=4*1024*1024;
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const sign=path=>createHmac('sha256',process.env.BLOB_READ_WRITE_TOKEN).update(path).digest('hex');
export default {async fetch(request){
 const method=request.method;
 if(!['POST','DELETE'].includes(method))return reply({error:'지원하지 않는 요청입니다.'},405);
 const origin=request.headers.get('origin');
 if(!origin || origin!==new URL(request.url).origin)return reply({error:'이 사이트에서 업로드해주세요.'},403);
 if(!process.env.BLOB_READ_WRITE_TOKEN)return reply({error:'이미지 저장소 연결을 확인 중입니다. 잠시 후 다시 시도하세요.'},503);
 try{
  if(method==='DELETE'){
   const {pathname,deleteKey}=await request.json();
   if(typeof pathname!=='string'||!/^qr-images\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.(png|jpg|gif|webp)$/.test(pathname)||typeof deleteKey!=='string'||!/^[a-f0-9]{64}$/.test(deleteKey))return reply({error:'삭제 정보가 올바르지 않습니다.'},400);
   if(!timingSafeEqual(Buffer.from(sign(pathname),'hex'),Buffer.from(deleteKey,'hex')))return reply({error:'삭제 권한을 확인할 수 없습니다.'},403);
   await del(pathname);return reply({deleted:true});
  }
  const length=Number(request.headers.get('content-length'));
  if(length>MAX)return reply({error:'이미지는 최대 4MB까지 업로드할 수 있습니다.'},413);
  const bytes=Buffer.from(await request.arrayBuffer());
  if(!bytes.length||bytes.length>MAX)return reply({error:'이미지는 최대 4MB까지 업로드할 수 있습니다.'},413);
  let type,ext;
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){type='image/png';ext='png'}
  else if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255){type='image/jpeg';ext='jpg'}
  else if(bytes.length>=6&&['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString())){type='image/gif';ext='gif'}
  else if(bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'){type='image/webp';ext='webp'}
  else return reply({error:'JPG, PNG, GIF, WEBP 이미지만 업로드할 수 있습니다.'},415);
  const prefix=`qr-images/${new Date().toISOString().slice(0,10)}/`;
  const today=await list({prefix,limit:100});
  if(today.blobs.length>=100)return reply({error:'오늘의 사이트 업로드 한도에 도달했습니다. 공개 링크 방식으로 QR을 만들어주세요.'},429);
  const pathname=prefix+randomUUID()+'.'+ext;
  const blob=await put(pathname,bytes,{access:'public',contentType:type,addRandomSuffix:false,cacheControlMaxAge:60});
  return reply({url:blob.url,pathname,deleteKey:sign(pathname)});
 }catch{return reply({error:'이미지 저장에 실패했습니다. 잠시 후 다시 시도해주세요.'},500)}
}};
