/* Private student identity, using the page's existing Supabase client. */
let sifaPhotoGeneration=0;
window.SIFAClearPhoto=()=>{sifaPhotoGeneration++;document.querySelectorAll('[data-sifa-photo]').forEach(e=>e.remove());};
window.SIFALoadPhoto=async(client,config,userId)=>{
 window.SIFAClearPhoto();const generation=sifaPhotoGeneration;
 if(!client.__sifaPhotoAuthListener){client.__sifaPhotoAuthListener=true;client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||(session&&session.user.id!==client.__sifaPhotoOwner))window.SIFAClearPhoto();});}client.__sifaPhotoOwner=userId;
 try{const {data}=await client.auth.getSession();const session=data.session;if(!session||session.user.id!==userId)return;
 const response=await fetch(config.url+'/functions/v1/public-application?action=photo',{method:'POST',headers:{apikey:config.anonKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});if(!response.ok)return;const result=await response.json();if(!result.photo_url)return;
 const {data:current}=await client.auth.getSession();if(current.session?.user.id!==userId||generation!==sifaPhotoGeneration)return;
 const toolbar=document.querySelector('#studentDashboard .sifa-student-toolbar');
 const target=toolbar?.querySelector('strong')||document.querySelector('header .brand');if(!target)return;
 const identity=document.createElement('span');identity.dataset.sifaPhoto='true';identity.style.cssText='display:inline-flex;align-items:center;gap:8px;flex-shrink:0;margin:0 12px;';
 const image=document.createElement('img');image.alt='Your student account photograph';image.referrerPolicy='no-referrer';image.style.cssText='width:40px;height:40px;object-fit:cover;border-radius:50%;border:2px solid #54ba7e;';image.onerror=()=>identity.remove();image.src=result.photo_url;identity.append(image);
 if(toolbar){target.before(identity);}else{const nav=target.parentElement;nav?.append(identity);}
 }catch{ /* Account remains usable when the photo is unavailable. */ }
};
