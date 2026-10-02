
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
if(apply){
  apply.addEventListener('submit',e=>{
    e.preventDefault();
    const data=new FormData(apply);
    const subject=encodeURIComponent('SIFA Course Application — '+(data.get('course')||''));
    const body=encodeURIComponent(
      `Name: ${data.get('name')}\nEmail: ${data.get('email')}\nCountry: ${data.get('country')}\nCourse: ${data.get('course')}\nExperience: ${data.get('experience')}\nGoals: ${data.get('goals')}`
    );
    window.location.href=`mailto:info.sifaglobal@yahoo.com?subject=${subject}&body=${body}`;
  });
}
