(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const clamp = (n,min=0,max=100) => Math.max(min,Math.min(max,n));
  const STAT_LABELS = {economy:"Экономика",people:"Народ",military:"Армия",political_capital:"Полит. капитал",health:"Здоровье президента"};
  const STAT_COLORS = {economy:"#267a5a",people:"#a67c2f",military:"#14776f",political_capital:"#8b1e43",health:"#647d91"};
  const DEFAULT_STATE = {
    countryId:"car", presidentNumber:1, name:"Господин Президент", gender:"Мужской",
    birthplace:"Банги", birthYear:1981, age:45, background:"Гражданская коалиция",
    education:"Государственное управление", party:"Национальный союз",
    startYear:2026, year:1, economy:38, people:43, military:52, political_capital:47, health:88,
    tension:42, reserve:0.8, budget:-3.2, used:[], chainQueue:[], history:[],
    mapRatings:[], eventsThisYear:0, eventsTarget:1, pendingEventId:null, electionPending:false,
    paused:true, speed:1, auto:false, music:false, ended:false, endReason:""
  };
  let state = loadState();
  let allEvents = [];
  let countries = [];
  let timer = null;
  let currentEvent = null;

  async function init(){
    try {
      const [eventsRes,countriesRes] = await Promise.all([fetch("./data/car-events.json"),fetch("./data/countries.json")]);
      if(!eventsRes.ok || !countriesRes.ok) throw new Error("Не удалось загрузить игровые данные");
      allEvents = await eventsRes.json(); countries = await countriesRes.json();
      validateEvents();
      renderAll();
      bindUI();
      if(!state.ended){
        if(state.pendingEventId && !state.used.includes(state.pendingEventId)){
          currentEvent=allEvents.find(e=>e.event_id===state.pendingEventId)||null;
          if(currentEvent) showEvent(currentEvent); else beginYearIfNeeded();
        } else beginYearIfNeeded();
      }
      updateTimer();
      if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(()=>{});
    } catch(err) {
      document.body.innerHTML = `<main style="max-width:700px;margin:10vh auto;padding:24px;font-family:Arial"><h1>The President</h1><p>Не удалось загрузить игровые данные. Проверьте, что папка <code>data</code> опубликована вместе с сайтом.</p><pre>${String(err.message)}</pre></main>`;
    }
  }
  function validateEvents(){
    const ids = new Set(allEvents.map(e=>e.event_id));
    for(const e of allEvents){
      if(!e.event_id || !Array.isArray(e.options) || !e.options.length) throw new Error("Некорректное событие: "+(e.event_id||"без ID"));
      for(const o of e.options) if(o.chained_event_id && !ids.has(o.chained_event_id)) console.warn("Не найдено цепное событие",o.chained_event_id);
    }
  }
  function loadState(){
    try { const raw=localStorage.getItem("thePresidentSaveV1"); return raw?{...structuredClone(DEFAULT_STATE),...JSON.parse(raw)}:structuredClone(DEFAULT_STATE); }
    catch { return structuredClone(DEFAULT_STATE); }
  }
  function saveState(){ try{localStorage.setItem("thePresidentSaveV1",JSON.stringify(state));}catch(e){console.warn("Save unavailable",e);} }
  function bindUI(){
    $("next-btn").addEventListener("click",()=>{ if(currentEvent) return; if(state.ended) return; if(state.electionPending){showElection();return;} openNextEvent(); });
    $("pause-btn").addEventListener("click",()=>{state.paused=!state.paused;updateTimer();renderControls();saveState();});
    document.querySelectorAll(".speed").forEach(b=>b.addEventListener("click",()=>{state.speed=Number(b.dataset.speed);renderControls();updateTimer();saveState();}));
    $("auto-btn").addEventListener("click",()=>{state.auto=!state.auto;state.paused=!state.auto;renderControls();updateTimer();saveState();});
    $("music-btn").addEventListener("click",()=>{state.music=!state.music;renderControls();saveState();});
    $("new-game-btn").addEventListener("click",()=>{if(confirm("Начать новую игру? Текущее сохранение будет заменено.")){state=structuredClone(DEFAULT_STATE);currentEvent=null;closeAll();saveState();renderAll();beginYearIfNeeded();}});
    $("result-continue").addEventListener("click",()=>{closeModal("result-modal");afterDecision();});
    $("election-continue").addEventListener("click",()=>{closeModal("election-modal");state.electionPending=false;if(!state.ended){beginYearIfNeeded();}saveState();renderAll();});
    $("about-btn").addEventListener("click",()=>openModal("about-modal"));
    $("rules-btn").addEventListener("click",()=>openModal("rules-modal"));
    document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.close)));
    $("event-modal").addEventListener("click",e=>{if(e.target.id==="event-modal"){}});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAll();});
  }
  function beginYearIfNeeded(){
    if(state.ended || state.electionPending || currentEvent) return;
    const already = state.eventsThisYear||0;
    if(already===0){
      state.eventsTarget = state.tension>=75?4:state.tension>=55?3:state.tension>=30?2:1;
    }
    if(already>=state.eventsTarget){
      finishYear();
      return;
    }
    openNextEvent();
  }
  function getUnusedPool(){
    return allEvents.filter(e=>e.country_id==="car" && !state.used.includes(e.event_id));
  }
  function openNextEvent(){
    if(state.ended || state.electionPending || currentEvent) return;
    let event=null;
    while(state.chainQueue.length && !event){
      const id=state.chainQueue.shift();
      if(!state.used.includes(id)) event=allEvents.find(e=>e.event_id===id);
    }
    if(!event){
      const pool=getUnusedPool();
      if(!pool.length){endGame("Все подготовленные события страны завершились. Ваша хроника сохранена.");return;}
      event=pool[Math.floor(Math.random()*pool.length)];
    }
    currentEvent=event;state.pendingEventId=event.event_id;state.paused=true;state.auto=false;
    renderControls();renderAll();showEvent(event);saveState();
  }
  function showEvent(e){
    $("event-year-label").textContent=`ГОД ${state.year} · СОБЫТИЕ ${state.eventsThisYear+1} ИЗ ${state.eventsTarget}`;
    $("event-title").textContent=e.title.replace(/^Год\s+\d+\.\s*/i,"");
    $("event-description").textContent=e.description;
    $("event-fact").textContent=e.fact_box;
    $("event-question").textContent=e.question||"Какое решение вы примете?";
    $("decree-input").value="";
    const root=$("event-options");root.innerHTML="";
    e.options.forEach((opt,i)=>{
      const btn=document.createElement("button");btn.className="option-card";btn.type="button";
      const title=document.createElement("div");
      title.innerHTML=`<span class="option-number">${i+1}</span>`;
      title.append(document.createTextNode(opt.option_text));
      btn.append(title);
      const chips=document.createElement("div");chips.className="option-consequences";
      Object.entries(opt.consequences||{}).forEach(([key,val])=>{
        if(!val)return;
        const chip=document.createElement("span");chip.className="delta-chip "+(val>0?"positive":"negative");
        chip.textContent=`${STAT_LABELS[key]||key} ${val>0?"+":""}${val}`;chips.append(chip);
      });
      btn.append(chips);
      const flavor=document.createElement("div");flavor.className="option-flavor";flavor.textContent=opt.option_flavor||"";btn.append(flavor);
      btn.addEventListener("click",()=>chooseOption(i));root.append(btn);
    });
    openModal("event-modal");
  }
  function chooseOption(index){
    if(!currentEvent)return;
    const event=currentEvent,opt=event.options[index];
    const decree=$("decree-input").value.trim();
    const changes=opt.consequences||{};
    Object.keys(changes).forEach(k=>{if(k in state && typeof state[k]==="number" && k!=="tension")state[k]=clamp(state[k]+changes[k]);});
    const t=parseInt(String(event.tension_change||"0").replace(/[^\d+-]/g,""),10)||0;
    state.tension=clamp(state.tension+t);
    state.used.push(event.event_id);
    if(opt.chained_event_id && !state.used.includes(opt.chained_event_id) && !state.chainQueue.includes(opt.chained_event_id))state.chainQueue.push(opt.chained_event_id);
    state.eventsThisYear++;
    const yearLabel=state.startYear+state.year-1;
    const entry={year:state.year,calendarYear:yearLabel,title:event.title.replace(/^Год\s+\d+\.\s*/i,""),detail:opt.option_flavor||"Решение принято.",decree,option:opt.option_text};
    state.history.unshift(entry);
    currentEvent=null;state.pendingEventId=null;
    closeModal("event-modal");
    showResult(entry,changes);
    saveState();renderAll();
  }
  function showResult(entry,changes){
    $("result-title").textContent=entry.title;
    $("result-copy").textContent=entry.detail+(entry.decree?` Ваш указ: «${entry.decree}».`:"");
    const root=$("result-deltas");root.innerHTML="";
    Object.entries(changes).forEach(([k,v])=>{if(!v)return;const s=document.createElement("span");s.className="delta-chip "+(v>0?"positive":"negative");s.textContent=`${STAT_LABELS[k]||k} ${v>0?"+":""}${v}`;root.append(s);});
    openModal("result-modal");
  }
  function afterDecision(){
    if(state.political_capital<=0){endGame("Парламентская коалиция распалась. Объявлен импичмент.");return;}
    if(state.health<=0){endGame("Состояние здоровья президента больше не позволяет продолжать исполнение обязанностей.");return;}
    if(state.eventsThisYear>=state.eventsTarget){finishYear();return;}
    beginYearIfNeeded();
  }
  function finishYear(){
    state.mapRatings.push(state.people);
    if(state.age>=60)state.health=clamp(state.health-(state.age>=70?8:4));
    state.age++;state.year++;state.eventsThisYear=0;
    if(state.health<=0){endGame("Президент завершил исполнение обязанностей по состоянию здоровья.");return;}
    if((state.year-1)%4===0 && state.year>1){state.electionPending=true;showElection();return;}
    if(state.year>40){endGame("Вы провели у власти 40 лет. Ваша эпоха вошла в историю страны.");return;}
    state.tension=clamp(state.tension+(state.people<30?7:state.people>70?-5:0));
    saveState();renderAll();beginYearIfNeeded();
  }
  function showElection(){
    const win=state.people>40 && state.political_capital>40;
    $("election-title").textContent=win?"Вы переизбраны":"Оппозиция победила";
    $("election-copy").textContent=win
      ?`Итоги ${state.startYear+state.year-2} года: вы сохранили поддержку избирателей и политических союзников. Начинается следующий срок.`
      :`Итоги ${state.startYear+state.year-2} года: рейтинг доверия или политический капитал оказался ниже необходимого уровня. Ваш срок завершён.`;
    if(win){state.presidentNumber=Math.min(10,state.presidentNumber+1);state.history.unshift({year:state.year-1,calendarYear:state.startYear+state.year-2,title:"Вы переизбраны",detail:`Начинается срок №${state.presidentNumber}.`,option:"Выборы"});}
    else {state.ended=true;state.endReason="Вы проиграли выборы кандидату от оппозиции. Ваш срок окончен.";}
    saveState();renderAll();openModal("election-modal");
  }
  function endGame(reason){state.ended=true;state.endReason=reason;state.paused=true;state.auto=false;state.history.unshift({year:state.year,calendarYear:state.startYear+state.year-1,title:"Конец президентства",detail:reason,option:"Game over"});saveState();renderAll();$("election-title").textContent="Конец игры";$("election-copy").textContent=reason;$("election-continue").textContent="Вернуться к хронике";openModal("election-modal");}
  function renderAll(){renderHeader();renderStats();renderFacts();renderChronicle();renderMap();renderControls();renderFocus();}
  function renderHeader(){
    $("president-number").textContent=state.presidentNumber+"-й";$("country-short").textContent="ЦАР";
    $("year-in-office").textContent=state.year;$("president-age").textContent=state.age;
    $("current-year").textContent=state.startYear+state.year-1;$("inauguration-year").textContent=state.startYear;
    $("president-name").textContent=state.name;$("president-gender").textContent=state.gender;
    $("birthplace").textContent=`${state.birthplace} · ${state.birthYear}`;
    $("background").textContent=state.background;$("education").textContent=state.education;$("party").textContent=state.party;
    $("reserve").textContent=`$${state.reserve.toFixed(1)} млрд`;$("budget").textContent=`${state.budget>0?"+":""}${state.budget.toFixed(1)}% ВВП`;
    $("tension").textContent=state.tension;$("fact-year").textContent="2025";
  }
  function renderStats(){
    const root=$("stats-list");root.innerHTML="";
    [["economy","Экономика"],["people","Народ"],["military","Армия"],["political_capital","Полит. капитал"],["health","Здоровье президента"]].forEach(([key,label])=>{
      const row=document.createElement("div");row.className="stat-row";
      row.innerHTML=`<span class="stat-label">${label}</span><div class="stat-track"><div class="stat-fill" style="width:${state[key]}%;background:${STAT_COLORS[key]}"></div></div><span class="stat-value">${state[key]}</span>`;
      root.append(row);
    });
  }
  function renderFacts(){
    const c=countries[0];if(!c)return;
    const root=$("country-facts");root.innerHTML="";
    c.facts.forEach(f=>{const div=document.createElement("div");div.className="fact";div.innerHTML=`<span>${f.label}</span><b>${f.value}</b><small>${f.note}</small>`;root.append(div);});
    $("source-links").innerHTML="";
    c.sources.forEach(s=>{const a=document.createElement("a");a.href=s.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=s.label+" ↗";$("source-links").append(a);});
  }
  function renderChronicle(){
    const root=$("chronicle");root.innerHTML="";
    if(!state.history.length){root.innerHTML='<div class="empty-chronicle">Здесь появятся ваши решения, последствия и политические повороты.</div>';return;}
    state.history.slice(0,30).forEach(h=>{const div=document.createElement("div");div.className="chronicle-entry";const time=document.createElement("time");time.textContent=`${h.year} год`;const content=document.createElement("div");const title=document.createElement("strong");title.textContent=h.title;const p=document.createElement("p");p.textContent=h.detail+(h.decree?` Указ: ${h.decree}`:"");content.append(title,p);div.append(time,content);root.append(div);});
  }
  function renderMap(){
    const root=$("presidency-map");root.innerHTML="";
    for(let i=1;i<=40;i++){
      const cell=document.createElement("div");cell.className="map-cell";
      if(i<state.year){cell.classList.add("past");const rating=state.mapRatings[i-1]??state.people;cell.style.setProperty("--cell-color",rating<30?"#b64b4b":rating<50?"#d7bd67":rating<70?"#77ae8c":"#267a5a");}
      if(i===state.year)cell.classList.add("current");
      cell.title=`Год ${i}${i<state.year?" · завершён":i===state.year?" · текущий":""}`;
      root.append(cell);
    }
  }
  function renderFocus(){
    const year=state.startYear+state.year-1;$("focus-year").textContent=year;
    $("events-left").textContent=`События: ${Math.max(0,state.eventsTarget-state.eventsThisYear)}`;
    $("annual-focus").textContent=state.ended?state.endReason:
      state.tension>70?"Напряжение в стране высокое. Кабинет получает несколько срочных докладов: каждое решение может изменить баланс сил.":
      state.people<35?"Доверие граждан снизилось. Приоритет — доступ к базовым услугам, прозрачность решений и восстановление общественного диалога.":
      "Вам предстоит определить приоритеты бюджета, укрепить государственные институты и сохранить доверие граждан.";
    $("scene-status").textContent=state.ended?"Президентство завершено.":state.tension>70?"Экстренное заседание кабинета.":"Рабочий день. Доклады ожидают подписи.";
    $("scene-weather").textContent=state.tension>70?"Грозовой фронт":"Переменная облачность";
  }
  function renderControls(){
    $("pause-btn").textContent=state.paused?"▶ Продолжить":"Ⅱ Пауза";
    document.querySelectorAll(".speed").forEach(b=>b.classList.toggle("active",Number(b.dataset.speed)===state.speed));
    $("auto-btn").textContent=`Авторежим: ${state.auto?"вкл.":"выкл."}`;
    $("music-btn").textContent=`♫ Музыка: ${state.music?"вкл.":"выкл."}`;
    $("next-btn").disabled=!!currentEvent||state.ended||state.electionPending;
    $("next-btn").style.opacity=$("next-btn").disabled?".5":"1";
  }
  function updateTimer(){if(timer){clearInterval(timer);timer=null;}if(!state.paused&&!state.ended&&!currentEvent){timer=setInterval(()=>{if(!currentEvent&&!state.electionPending)beginYearIfNeeded();},15000/state.speed);}}
  function openModal(id){$(id).classList.remove("hidden");}
  function closeModal(id){$(id).classList.add("hidden");}
  function closeAll(){document.querySelectorAll(".modal-backdrop").forEach(m=>m.classList.add("hidden"));}
  init();
})();