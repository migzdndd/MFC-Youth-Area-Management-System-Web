// This file handles the simple demo account system.
const USER_KEY = 'mfc_demo_users';
const SESSION_KEY = 'mfc_demo_session';

// Reads saved demo users from the browser.
function getUsers(){ return JSON.parse(localStorage.getItem(USER_KEY) || '[]'); }

// Shows a small message inside an auth form.
function showMessage(id,text,type='error'){
  const box=document.getElementById(id); if(!box) return;
  box.innerHTML=`<div class="message ${type}">${text}</div>`;
}

// Login page logic.
const loginForm=document.getElementById('loginForm');
if(loginForm){
  loginForm.addEventListener('submit',e=>{
    e.preventDefault();
    const email=document.getElementById('loginEmail').value.trim().toLowerCase();
    const password=document.getElementById('loginPassword').value;
    const users=getUsers();
    const user=users.find(u=>u.email===email && u.password===password);
    // A demo account lets the first-time prototype open quickly.
    const demoOk=email==='admin@mfcyouth.local' && password==='admin123';
    if(!user && !demoOk){ showMessage('loginMessage','Account not found or password is incorrect.'); return; }
    const name=user?.name || 'Area Administrator';
    localStorage.setItem(SESSION_KEY,JSON.stringify({email,name,loginAt:new Date().toISOString()}));
    location.href='dashboard.html';
  });
}

// Register page logic.
const registerForm=document.getElementById('registerForm');
if(registerForm){
  registerForm.addEventListener('submit',e=>{
    e.preventDefault();
    const name=document.getElementById('regName').value.trim();
    const email=document.getElementById('regEmail').value.trim().toLowerCase();
    const password=document.getElementById('regPassword').value;
    const confirm=document.getElementById('regConfirm').value;
    if(password!==confirm){ showMessage('registerMessage','Passwords do not match.'); return; }
    const users=getUsers();
    if(users.some(u=>u.email===email)){ showMessage('registerMessage','That email is already registered.'); return; }
    users.push({id:Date.now(),name,email,password});
    localStorage.setItem(USER_KEY,JSON.stringify(users));
    showMessage('registerMessage','Account created. You can sign in now.','success');
    setTimeout(()=>location.href='login.html',900);
  });
}

// Recovery page logic. This does not send a real email yet.
const recoverForm=document.getElementById('recoverForm');
if(recoverForm){
  recoverForm.addEventListener('submit',e=>{
    e.preventDefault();
    const email=document.getElementById('recoverEmail').value.trim().toLowerCase();
    const user=getUsers().find(u=>u.email===email);
    if(user){ showMessage('recoverMessage','Demo account found. Real email recovery will be connected to the backend later.','success'); }
    else { showMessage('recoverMessage','No demo account was found with that email.'); }
  });
}
