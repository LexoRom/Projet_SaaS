const $ = s => document.querySelector(s);
let token = localStorage.getItem("token");
let me = null, users = [], projects = [], currentProject = null, tasks = [];
let editingProjectId = null, editingTaskId = null, editingUserId = null;
let selectedAssigneeIds = [];

const api = async (url, options={}) => {
  const headers = {"Content-Type":"application/json", ...(options.headers||{})};
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, {...options, headers});
  if (r.status === 204) return null;
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "Erreur");
  return data;
};

function msg(text){ $("#authMsg").textContent = text || ""; }
function showApp(on){ $("#authView").classList.toggle("hidden", on); $("#appView").classList.toggle("hidden", !on); $("#sessionBar").classList.toggle("hidden", !on); }

async function loadSession(){
  try {
    const data = await api("/api/me");
    me = data.user;
    $("#companyLabel").textContent = data.company.name;
    $("#userLabel").textContent = `${me.name} (${me.role})`;
    const isAdmin = me.role === "admin";
    $("#newCompanyBtn").classList.toggle("hidden", !isAdmin);
    $("#editCompanyBtn").classList.toggle("hidden", !isAdmin);
    $("#deleteCompanyBtn").classList.toggle("hidden", !isAdmin);
    $("#userAddSection").classList.toggle("hidden", !isAdmin);
    showApp(true);
    await Promise.all([loadUsers(), loadProjects()]);
  } catch {
    token = null; localStorage.removeItem("token"); showApp(false);
  }
}

async function loadUsers(){
  users = await api("/api/users");
  renderUsers();
}
function renderUsers(){
  $("#usersList").innerHTML = users.map(u => `
    <div class="member"><span>${escapeHtml(u.name)} — ${escapeHtml(u.email)} <span class="badge">${u.role}</span></span>
    ${me?.role === "admin" ? `<button type="button" class="secondary" onclick="openUserEdit('${u._id}')">Modifier</button>${u._id === me?._id ? "" : `<button type="button" class="danger" onclick="removeUser('${u._id}')">Supprimer</button>`}` : ""}</div>
  `).join("");
}
function renderProjectMembers(){
  const selected = new Set((editingProjectId ? currentProject?.userIds || [] : []).map(user => typeof user === "object" ? user._id : user));
  $("#projectMembers").innerHTML = users.map(u => `<label class="member"><input type="checkbox" name="members" value="${u._id}" ${selected.has(u._id) ? "checked" : ""}> ${escapeHtml(u.name)}</label>`).join("");
}

function initials(name){return String(name||"?").trim().split(/\s+/).slice(0,2).map(part=>part[0]||"").join("").toUpperCase()}
function localDate(value){const date=new Date(value);return new Date(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())}
function avatar(user,title="") { return `<span class="avatar" title="${escapeHtml(title||user.name)}" aria-label="${escapeHtml(title||user.name)}">${escapeHtml(initials(user.name))}</span>` }
function renderProjectAvatars(){
  const members=(currentProject?.userIds||[]).filter(user=>typeof user==="object");
  const visible=members.slice(0,5).map(user=>avatar(user)).join("");
  const more=members.length>5?`<span class="avatar more" title="${members.length-5} autres">+${members.length-5}</span>`:"";
  $("#projectMemberAvatars").innerHTML=visible+more;
}
function renderAssigneePicker(){
  const memberIds=new Set((currentProject?.userIds||[]).map(user=>typeof user==="object"?user._id:user));
  const members=users.filter(user=>memberIds.has(user._id));
  const query=$("#assigneeSearch").value.trim().toLocaleLowerCase();
  if(!members.length){$("#assigneeChoices").innerHTML='<p class="muted">Ajoutez des membres au projet pour pouvoir les assigner.</p>';$("#selectedAssignees").innerHTML='<span class="muted">Aucun assigné</span>';return;}
  $("#assigneeChoices").innerHTML=members.map(user=>{
    const checked=selectedAssigneeIds.includes(user._id);
    const visible=user.name.toLocaleLowerCase().includes(query)||user.email.toLocaleLowerCase().includes(query);
    return `<label class="assignee-option ${checked?"selected":""}" ${visible?"":"hidden"}><input type="checkbox" name="assigneeChoice" value="${user._id}" ${checked?"checked":""}><span>${escapeHtml(user.name)}</span><small>${escapeHtml(user.email)}</small></label>`;
  }).join("");
  const selected=members.filter(user=>selectedAssigneeIds.includes(user._id));
  $("#selectedAssignees").innerHTML=selected.length?selected.map(user=>`<span class="assignee-chip">${escapeHtml(user.name)} <button type="button" data-remove-assignee="${user._id}" aria-label="Retirer ${escapeHtml(user.name)}">×</button></span>`).join(""):'<span class="muted">Aucun assigné</span>';
  $("#assigneeChoices").querySelectorAll('input[name="assigneeChoice"]').forEach(input=>input.onchange=()=>{
    selectedAssigneeIds=[...$("#assigneeChoices").querySelectorAll('input[name="assigneeChoice"]:checked')].map(item=>item.value);
    input.closest(".assignee-option").classList.toggle("selected",input.checked);
    renderAssigneeSummary();
  });
  $("#selectedAssignees").querySelectorAll("[data-remove-assignee]").forEach(button=>button.onclick=()=>{
    selectedAssigneeIds=selectedAssigneeIds.filter(id=>id!==button.dataset.removeAssignee);
    renderAssigneePicker();
  });
}
function renderAssigneeSummary(){
  const selected=users.filter(user=>selectedAssigneeIds.includes(user._id));
  $("#selectedAssignees").innerHTML=selected.length?selected.map(user=>`<span class="assignee-chip">${escapeHtml(user.name)} <button type="button" data-remove-assignee="${user._id}" aria-label="Retirer ${escapeHtml(user.name)}">×</button></span>`).join(""):'<span class="muted">Aucun assigné</span>';
  $("#selectedAssignees").querySelectorAll("[data-remove-assignee]").forEach(button=>button.onclick=()=>{selectedAssigneeIds=selectedAssigneeIds.filter(id=>id!==button.dataset.removeAssignee);renderAssigneePicker()});
}

async function loadProjects(){
  projects = await api("/api/projects");
  const sel = $("#projectSelect");
  sel.innerHTML = projects.map(p => `<option value="${p._id}">${escapeHtml(p.name)}</option>`).join("");
  if (!projects.length){ currentProject=null; tasks=[]; renderBoard(); return; }
  if (!currentProject || !projects.some(p=>p._id===currentProject._id)) currentProject=projects[0];
  sel.value=currentProject._id;
  await loadTasks();
}
async function loadTasks(){
  currentProject = projects.find(p=>p._id === $("#projectSelect").value) || currentProject;
  if (!currentProject){ renderBoard(); return; }
  tasks = await api(`/api/projects/${currentProject._id}/tasks`);
  renderBoard();
}
function renderBoard(){
  $("#projectName").textContent = currentProject?.name || "Aucun projet";
  $("#projectDescription").textContent = currentProject?.description || "";
  renderProjectAvatars();
  const query=$("#taskSearch").value.trim().toLocaleLowerCase();
  const priority=$("#priorityFilter").value;
  const due=$("#dueFilter").value;
  const mine=$("#onlyMine").checked;
  const now=new Date(); now.setHours(0,0,0,0);
  const week=new Date(now); week.setDate(week.getDate()+7);
  const visibleTasks=tasks.filter(task=>{
    const text=`${task.title} ${task.description||""}`.toLocaleLowerCase();
    const dueDate=task.dueDate?localDate(task.dueDate):null;
    const assigned=(task.assigneeIds||[]).some(user=>user._id===me?._id);
    return (!query||text.includes(query))&&
      (priority==="all"||task.priority===priority)&&
      (!mine||assigned)&&
      (due==="all"||(due==="none"&&!dueDate)||(due==="overdue"&&dueDate&&dueDate<now&&task.status!=="done")||(due==="week"&&dueDate&&dueDate>=now&&dueDate<=week));
  });
  const overdue=tasks.filter(task=>task.dueDate&&localDate(task.dueDate)<now&&task.status!=="done").length;
  const done=tasks.filter(task=>task.status==="done").length;
  $("#taskTotal").textContent=tasks.length;
  $("#taskPlural").textContent=tasks.length===1?"":"s";
  $("#taskProgress").textContent=done;
  $("#donePlural").textContent=done===1?"e":"es";
  $("#taskOverdue").textContent=overdue;
  $("#filterResult").textContent=visibleTasks.length!==tasks.length?`${visibleTasks.length} affichée${visibleTasks.length===1?"":"s"}`:"";
  $("#filterResult").classList.toggle("hidden",visibleTasks.length===tasks.length);
  $("#clearFilters").classList.toggle("hidden",!query&&priority==="all"&&due==="all"&&!mine);
  ["todo","doing","done"].forEach(status=>{
    const columnTasks=visibleTasks.filter(task=>task.status===status);
    const zone=$("#"+status); zone.innerHTML="";
    $("#"+status+"Count").textContent=columnTasks.length;
    if(!columnTasks.length){zone.innerHTML=`<div class="empty-column">${tasks.length&&!visibleTasks.length?"Aucun résultat":"Déposez une tâche ici"}<span>${tasks.length&&!visibleTasks.length?"Essayez d'effacer les filtres":"ou ajoutez une nouvelle tâche"}</span></div>`;return;}
    columnTasks.forEach((t,index)=>{
    const el=document.createElement("article");
    const assignees=(t.assigneeIds||[]).filter(Boolean);
    const dueDate=t.dueDate?localDate(t.dueDate):null;
    const isOverdue=dueDate&&dueDate<now&&t.status!=="done";
    const isSoon=dueDate&&t.status!=="done"&&!isOverdue&&(dueDate-now)<=7*86400000;
    const priorityLabel={high:"Urgente",medium:"Normale",low:"Faible"}[t.priority]||t.priority;
    el.className="task"; el.draggable=true; el.dataset.id=t._id; el.style.setProperty("--card-index",index);
    el.style.setProperty("--priority-color",t.priority==="high"?"#e77475":t.priority==="medium"?"#e7a84c":"#45aa8e");
    el.innerHTML=`<strong class="task-title">${escapeHtml(t.title)}</strong>
      ${t.description?`<p class="task-description">${escapeHtml(t.description)}</p>`:""}
      <div class="task-foot"><span class="priority-badge priority-${t.priority}">${priorityLabel}</span><div class="card-actions"><button type="button" onclick="openTaskEdit('${t._id}')">Modifier</button><button type="button" class="danger" onclick="deleteTask('${t._id}')" aria-label="Supprimer la tâche">Supprimer</button></div></div>
      <div class="task-meta"><div class="task-assignees">${assignees.slice(0,3).map(user=>avatar(user)).join("")}${assignees.length>3?`<span class="avatar more">+${assignees.length-3}</span>`:""}<span class="assignee-name">${escapeHtml(assignees.map(user=>user.name).join(", ")||"Non assignée")}</span></div>
      ${dueDate?`<span class="task-date ${isOverdue?"overdue":isSoon?"soon":""}">◷ ${dueDate.toLocaleDateString("fr-FR",{day:"numeric",month:"short"})}${isOverdue?" · En retard":""}</span>`:""}</div>`;
    el.addEventListener("dragstart", e=>{e.dataTransfer.setData("text/plain",t._id);el.classList.add("is-dragging")});
    el.addEventListener("dragend",()=>el.classList.remove("is-dragging"));
    el.addEventListener("dblclick",event=>{if(!event.target.closest("button"))openTaskEdit(t._id)});
    zone.appendChild(el);
    });
  });
}
async function deleteTask(id){
  if(!confirm("Supprimer cette tâche ?")) return;
  await api(`/api/tasks/${id}`,{method:"DELETE"}); await loadTasks();
}
async function removeUser(id){
  if(!confirm("Supprimer cet utilisateur ?")) return;
  await api(`/api/users/${id}`,{method:"DELETE"}); await loadUsers(); await loadProjects();
}
function openUserEdit(id){
  const user=users.find(candidate=>candidate._id===id);
  if(!user)return;
  editingUserId=id;
  const form=$("#userEditForm");
  form.elements.name.value=user.name;
  form.elements.email.value=user.email;
  form.elements.role.value=user.role;
  form.elements.password.value="";
  $("#userEditDialog").showModal();
}
function openProjectEdit(){
  if(!currentProject)return;
  editingProjectId=currentProject._id;
  const form=$("#projectForm");
  form.reset();
  form.elements.name.value=currentProject.name;
  form.elements.description.value=currentProject.description||"";
  $("#projectDialogTitle").textContent="Modifier le projet";
  $("#projectMembers").innerHTML="";
  renderProjectMembers();
  $("#projectDialog").showModal();
}
function openTaskEdit(id){
  const task=tasks.find(candidate=>candidate._id===id);
  if(!task)return;
  editingTaskId=id;
  const form=$("#taskForm");
  form.reset();
  selectedAssigneeIds=(task.assigneeIds||[]).filter(Boolean).map(user=>user._id);
  $("#assigneeSearch").value="";
  renderAssigneePicker();
  form.elements.title.value=task.title;
  form.elements.description.value=task.description||"";
  form.elements.priority.value=task.priority;
  form.elements.status.value=task.status;
  form.elements.dueDate.value=task.dueDate?new Date(task.dueDate).toISOString().slice(0,10):"";
  $("#taskDialogTitle").textContent="Modifier la tâche";
  $("#taskSubmitBtn").textContent="Enregistrer";
  $("#taskDialog").showModal();
}
async function editCompany(){
  const company=await api("/api/company");
  $("#companyForm").elements.name.value=company.name;
  $("#companyDialog").showModal();
}
async function deleteCompany(){
  const company=await api("/api/company");
  const confirmation=prompt(`Cette action supprime définitivement l'entreprise, ses utilisateurs, projets et tâches. Tapez « ${company.name} » pour confirmer.`);
  if(confirmation!==company.name)return;
  await api("/api/company",{method:"DELETE"});
  token=null; me=null; localStorage.removeItem("token"); showApp(false); msg("Entreprise supprimée. Vous pouvez effectuer une nouvelle installation.");
  $("#bootstrapTab").click();
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

$("#loginTab").onclick=()=>{$("#loginForm").classList.remove("hidden");$("#bootstrapForm").classList.add("hidden");$("#loginTab").classList.add("active");$("#bootstrapTab").classList.remove("active")};
$("#bootstrapTab").onclick=()=>{$("#bootstrapForm").classList.remove("hidden");$("#loginForm").classList.add("hidden");$("#bootstrapTab").classList.add("active");$("#loginTab").classList.remove("active")};
$("#loginForm").onsubmit=async e=>{e.preventDefault();msg("");try{const f=new FormData(e.target);const d=await api("/api/auth/login",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});token=d.token;localStorage.setItem("token",token);await loadSession()}catch(err){msg(err.message)}};
$("#bootstrapForm").onsubmit=async e=>{e.preventDefault();msg("");try{const f=new FormData(e.target);await api("/api/bootstrap",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});msg("Entreprise créée. Vous pouvez maintenant vous connecter.");$("#loginTab").click()}catch(err){msg(err.message==="Le bootstrap est déjà effectué."?"Une entreprise existe déjà. Connectez-vous comme administrateur puis cliquez sur « Nouvelle entreprise ».":err.message)}};
$("#logoutBtn").onclick=()=>{token=null;localStorage.removeItem("token");showApp(false)};
$("#projectSelect").onchange=loadTasks;
$("#newProjectBtn").onclick=()=>{editingProjectId=null;$("#projectForm").reset();$("#projectDialogTitle").textContent="Nouveau projet";renderProjectMembers();$("#projectDialog").showModal()};
$("#editProjectBtn").onclick=openProjectEdit;
function openNewTask(status="todo"){
  if(!currentProject)return alert("Créez d'abord un projet.");
  editingTaskId=null;selectedAssigneeIds=[];$("#taskForm").reset();$("#assigneeSearch").value="";renderAssigneePicker();
  $("#taskForm").elements.status.value=status;$("#taskDialogTitle").textContent="Nouvelle tâche";$("#taskSubmitBtn").textContent="Créer la tâche";$("#taskDialog").showModal();
}
$("#newTaskBtn").onclick=()=>openNewTask();
document.querySelectorAll("[data-add-status]").forEach(button=>button.onclick=()=>openNewTask(button.dataset.addStatus));
$("#usersBtn").onclick=()=>{$("#usersDialog").showModal()};
$("#deleteProjectBtn").onclick=async()=>{if(!currentProject)return;if(!confirm("Supprimer le projet et ses tâches ?"))return;await api(`/api/projects/${currentProject._id}`,{method:"DELETE"});currentProject=null;await loadProjects()};
$("#projectForm").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const userIds=[...document.querySelectorAll('input[name="members"]:checked')].map(x=>x.value);const body=JSON.stringify({name:f.get("name"),description:f.get("description"),userIds});await api(editingProjectId?`/api/projects/${editingProjectId}`:"/api/projects",{method:editingProjectId?"PATCH":"POST",body});editingProjectId=null;e.target.reset();$("#projectDialog").close();await loadProjects()}catch(err){alert(err.message)}};
$("#taskForm").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const body=JSON.stringify({title:f.get("title"),description:f.get("description"),assigneeIds:selectedAssigneeIds,priority:f.get("priority"),status:f.get("status"),dueDate:f.get("dueDate")||null});if(editingTaskId)await api(`/api/tasks/${editingTaskId}`,{method:"PATCH",body});else await api(`/api/projects/${currentProject._id}/tasks`,{method:"POST",body});editingTaskId=null;e.target.reset();$("#taskDialog").close();await loadTasks()}catch(err){alert(err.message)}};
for(const status of ["todo","doing","done"]){
  const z=$("#"+status);
  const column=z.closest(".column");
  z.addEventListener("dragover",e=>{e.preventDefault();column.classList.add("is-over")});
  z.addEventListener("dragleave",e=>{if(!z.contains(e.relatedTarget))column.classList.remove("is-over")});
  z.addEventListener("drop",async e=>{e.preventDefault();column.classList.remove("is-over");const id=e.dataTransfer.getData("text/plain");try{await api(`/api/tasks/${id}`,{method:"PATCH",body:JSON.stringify({status})});await loadTasks()}catch(err){alert(err.message)}});
}
$("#taskSearch").addEventListener("input",renderBoard);
$("#priorityFilter").addEventListener("change",renderBoard);
$("#dueFilter").addEventListener("change",renderBoard);
$("#onlyMine").addEventListener("change",renderBoard);
$("#clearFilters").onclick=()=>{$("#taskSearch").value="";$("#priorityFilter").value="all";$("#dueFilter").value="all";$("#onlyMine").checked=false;renderBoard()};
$("#assigneeSearch").addEventListener("input",renderAssigneePicker);
$("#taskSearch").addEventListener("keydown",e=>{if(e.key==="Escape"){e.currentTarget.value="";renderBoard()}});
$("#userForm").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);await api("/api/users",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});e.target.reset();await loadUsers()}catch(err){alert(err.message)}};
$("#userEditForm").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const id=editingUserId;const body=Object.fromEntries(f);if(!body.password)delete body.password;const updated=await api(`/api/users/${id}`,{method:"PATCH",body:JSON.stringify(body)});if(id===me?._id){me=updated;$("#userLabel").textContent=`${me.name} (${me.role})`;const isAdmin=me.role==="admin";$("#newCompanyBtn").classList.toggle("hidden",!isAdmin);$("#editCompanyBtn").classList.toggle("hidden",!isAdmin);$("#deleteCompanyBtn").classList.toggle("hidden",!isAdmin);$("#userAddSection").classList.toggle("hidden",!isAdmin)}editingUserId=null;e.target.reset();$("#userEditDialog").close();await loadUsers()}catch(err){alert(err.message)}};
$("#companyForm").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const company=await api("/api/company",{method:"PATCH",body:JSON.stringify({name:f.get("name")})});$("#companyLabel").textContent=company.name;$("#companyDialog").close()}catch(err){alert(err.message)}};
$("#editCompanyBtn").onclick=()=>editCompany().catch(err=>alert(err.message));
$("#deleteCompanyBtn").onclick=()=>deleteCompany().catch(err=>alert(err.message));
$("#newCompanyBtn").onclick=()=>{$("#newCompanyForm").reset();$("#newCompanyDialog").showModal()};
$("#newCompanyForm").onsubmit=async e=>{e.preventDefault();try{const f=new FormData(e.target);const data=await api("/api/companies",{method:"POST",body:JSON.stringify(Object.fromEntries(f))});token=data.token;localStorage.setItem("token",token);$("#newCompanyDialog").close();await loadSession()}catch(err){alert(err.message)}};

loadSession();
