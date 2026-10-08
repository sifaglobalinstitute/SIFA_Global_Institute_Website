
const menu=document.querySelector('.menu');
const nav=document.querySelector('nav ul');
if(menu&&nav){menu.addEventListener('click',()=>nav.classList.toggle('open'))}

document.querySelectorAll('a[href^="#"]').forEach(a=>{
  a.addEventListener('click',e=>{
    const id=a.getAttribute('href');
    if(id.length>1){
      const el=document.querySelector(id);
      if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth'});nav?.classList.remove('open')}
    }
  })
});

const year=document.querySelector('[data-year]');
if(year) year.textContent=new Date().getFullYear();

const apply=document.querySelector('#applicationForm');

