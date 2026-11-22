/* Chassé d'Ours — duel à deux (ou plus) dans les ruines : chacun voit l'autre, sauf s'il se cache. */
const Duel = (() => {
  'use strict';
  let G, joinUntil = 0, joinKey = '', myName = 'Promeneur', lastHit = null, sendAcc = 0, score = 0, over = false, sightHold = 0, scoreKey = '', role = 'host', failed = false;
  let GOAL = 11;
  const JOIN_MS = 5 * 60 * 1000;
  const others = new Map(), $ = id => document.getElementById(id);
  const ARENA = { x: 10, z: -95, r: 54 };
  const SPAWNS = [[10, -66], [21, -119], [-4, -96], [20.5, -82]];
  const COLORS = [[0x2f6fb5, 0x265d99], [0x8a3fb0, 0x733494], [0x1f9a8a, 0x1a8071]];
  const r2 = v => Math.round(v * 100) / 100, num = v => typeof v === 'number' && isFinite(v);
  const dummy = (x, z) => ({ x, z, rad: 0.6, size: 0.75, flash: 0, squash: 0 });

  function init(api) {
    G = api;
    Net.on('data', onData);
    Net.on('call', onCall);
    $('lobby-start').addEventListener('click', pressStart);
    $('mic-enable').addEventListener('click', () => enableMic());
    $('mic-reload').addEventListener('click', () => location.reload());
    $('mic-open').addEventListener('change', e => setOpenMic(e.target.checked));
    $('t-shout').addEventListener('pointerdown', e => { e.preventDefault(); $('shouts').hidden = !$('shouts').hidden; });
    const sh = $('shouts'); SHOUTS.forEach((m, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = m; b.addEventListener('pointerdown', e => { e.preventDefault(); shout(i); }); sh.appendChild(b); });
    const ls = $('lobby-shouts'); SHOUTS.forEach((m, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost'; b.textContent = m; b.addEventListener('click', () => shout(i)); ls.appendChild(b); });
    addEventListener('keydown', e => { if (G.S.duel && !e.repeat && /^Digit[1-6]$/.test(e.code) && !(e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') && $('levelup').hidden) shout(+e.code.slice(-1) - 1); });
    $('lobby-chat').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
    document.querySelectorAll('[data-mic]').forEach(b => {
      b.addEventListener('pointerdown', e => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (_) { /* rien */ } micDown(); });
      const up = () => micUp(); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('contextmenu', e => e.preventDefault());
    });
    addEventListener('keydown', e => { if (e.code === 'KeyV' && !e.repeat && G.S.duel && !(e.target && e.target.tagName === 'INPUT' && e.target.type === 'text')) micDown(); });
    addEventListener('keyup', e => { if (e.code === 'KeyV' && G.S.duel) micUp(); });
    Net.on('leave', id => { const gid = id === undefined ? null : Net.gameId(id); const a = gid && audios.get(gid); if (a) { a.remove(); audios.delete(gid); } if (gid) outCalls.delete(gid); drop(gid === null ? null : gid); renderLobby(true); if (!others.size) G.banner('Adversaire parti<small>Le lien reste valable tant que tu gardes la page ouverte</small>', '', 4000); });
    $('invite-close').addEventListener('click', () => { $('invite').hidden = true; });
    const hhmm = () => new Date(joinUntil).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    shareText = () => `Rejoins mon duel dans Chassé d'Ours avant ${hhmm()} (le lien est valable 5 minutes) : ${$('invite-link').value}`;
    $('invite-copy').addEventListener('click', () => {
      const inp = $('invite-link'), ok = () => { $('invite-copy').textContent = 'Lien copié'; };
      // secours si le presse-papiers est refusé : ancienne méthode, sinon on laisse le lien sélectionné
      const sel = () => { inp.focus(); inp.select(); inp.setSelectionRange(0, 9999); let done = false; try { done = document.execCommand('copy'); } catch (_) { /* rien */ } if (done) ok(); else $('invite-copy').textContent = 'Lien sélectionné : copie-le'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(shareText()).then(ok).catch(sel); else sel();
    });
    $('invite-share').addEventListener('click', () => { navigator.share({ title: 'Chassé d\'Ours', text: shareText() }).catch(() => { }); });
  }
  function place(i) { const s = SPAWNS[i % SPAWNS.length], P = G.P; P.x = s[0]; P.z = s[1]; P.y = 0; P.vy = 0; P.ground = true; P.climb = false; P.vx = P.vz = 0; P.fly = null; P.hurtT = 0; G.pm.pose.rotation.x = 0; G.cam.init = false; }
  function fail(title, msg) { failed = true; G.card({ eyebrow: 'Duel', title, paras: [msg], button: 'Retour à la balade' }, () => { try { location.hash = ''; } catch (_) { /* rien */ } location.reload(); }); }

  function start(r, code) {
    role = r; score = 0; over = false; place(r === 'host' ? 0 : 1); $('duel-score').hidden = false; refresh(); openLobby();
    if (r === 'host') {
      G.banner('Création du duel<small>Mise en relation en cours</small>', '', 2500);
      Net.host((err, c) => {
        if (err) { fail('Mise en relation impossible', 'Le service qui relie les deux navigateurs ne répond pas. Vérifie ta connexion, puis réessaie.'); return; }
        const link = location.href.split('#')[0] + '#duel-' + c;
        joinUntil = Date.now() + JOIN_MS;   // on peut rejoindre pendant cinq minutes
        $('invite-link').value = link; $('invite-share').hidden = !navigator.share; $('invite').hidden = false; renderLobby(true);
      });
    } else {
      G.banner('Connexion au duel<small>Mise en relation en cours</small>', '', 2500);
      Net.join(code, err => {
        if (err) { fail('Duel introuvable', 'Le lien a expiré, ou la personne qui t\'invite a fermé la page. Demande-lui un nouveau lien.'); return; }
        G.banner('Connecté<small>Le salon attend que quelqu\'un lance la partie</small>', '', 3000);
      });
    }
  }

  function add(id, d) {
    const col = COLORS[others.size % COLORS.length], model = Actors.makePlayer({ remote: true, shirt: col[0], sleeve: col[1] });
    G.scene.add(model.root);
    const o = { id, model, x: d.x, y: d.y, z: d.z, f: d.f, tx: d.x, ty: d.y, tz: d.z, tf: d.f, v: 0, c: 0, ch: 0, k: 0, sp: 0, h: 0, inv: 0, fl: 0, sc: 0, cp: 0, kp: 0, spk: 0, vis: true, seen: performance.now() };
    others.set(id, o); if (!inLobby) $('invite').hidden = true; renderLobby(true); setTimeout(callAll, 600);
    if (World.broken.length) Net.send({ t: 'brks', l: World.broken.slice(-500).map(b => [b[0], b[1], r2(b[2]), r2(b[3])]) });   // le nouveau venu rattrape ce qui est déjà cassé
    if (failed) { failed = false; G.dismissCard(); }   // la liaison a fini par s'établir : on retire le message d'échec
    G.banner(`Un adversaire entre dans les ruines<small>Premier à ${GOAL} points</small>`, 'red', 3000); Snd.alert();
    return o;
  }
  function drop(id) { for (const o of [...others.values()]) if (id === null || o.id === id || (!Net.isHost && id !== undefined)) { G.scene.remove(o.model.root); others.delete(o.id); } scoreKey = ''; }

  function onData(d) {
    if (d.t === 's') {
      if (!num(d.x) || !num(d.z) || !num(d.f) || typeof d.id !== 'string' || d.id === Net.id()) return;
      d.y = num(d.y) ? d.y : 0;
      const o = others.get(d.id) || add(d.id, d), now = performance.now(), gap = Math.max(0.03, (now - o.seen) / 1000);
      o.v = Math.hypot(d.x - o.tx, d.z - o.tz) / gap; o.seen = now; o.tx = d.x; o.ty = d.y; o.tz = d.z; o.tf = d.f;
      o.c = d.c ? 1 : 0; o.ch = num(d.ch) ? U.clamp(d.ch, 0, 1) : 0; o.k = d.k ? 1 : 0; o.sp = d.sp ? 1 : 0; o.h = d.h ? 1 : 0; o.inv = d.inv ? 1 : 0; o.fl = d.fl ? 1 : 0; o.sc = num(d.sc) ? d.sc | 0 : 0; o.hp = num(d.hp) ? U.clamp(d.hp, 0, 100) : 100;
      if (inLobby) renderLobby();
      if (d.id === 'h' && !Net.isHost && num(d.g) && [5, 11, 21].includes(d.g) && d.g !== GOAL) { GOAL = d.g; scoreKey = ''; }   // l'hôte fixe le nombre de points
      if (typeof d.n === 'string') { const nm = d.n.replace(/[\u0000-\u001f]/g, '').slice(0, 14).trim(); if (nm && nm !== o.name) { const first = !o.name; o.name = nm; scoreKey = ''; if (first) G.banner(`${nm} entre dans les ruines<small>Premier à ${GOAL} points</small>`, 'red', 3600); } }
      if (num(d.tp) && d.tp !== o.tp) { if (o.tp !== undefined) { FX.tpOut(o.x, o.y, o.z); o.x = d.x; o.y = d.y; o.z = d.z; o.f = d.f; FX.tpIn(o.x, o.y, o.z); Snd.teleport(); } o.tp = d.tp; }
    } else if (d.t === 'hit' && d.to === Net.id()) takeHit(d);
    else if (d.t === 'win' && !over) { over = true; const w = others.get(d.id); G.whenCalm(() => endCard(false, w && w.name)); }
    else if (d.t === 'again') { reset(); G.dismissCard(); }
    else if (d.t === 'start') beginCountdown();
    else if (d.t === 'talk' && typeof d.id === 'string') { const o = others.get(d.id); if (o) { o.talk = !!d.on; renderLobby(); } }
    else if (d.t === 'chat' && typeof d.m === 'string' && typeof d.n === 'string' && d.s && !inLobby) { const o = others.get(d.id); if (o) o.bubble = { m: d.m.slice(0, 40), t: performance.now() }; chatLog.push({ n: d.n.slice(0, 14), m: d.m.slice(0, 120) }); Snd.ui(); }
    else if (d.t === 'chat' && typeof d.m === 'string' && typeof d.n === 'string') { chatLog.push({ n: d.n.slice(0, 14), m: d.m.slice(0, 120) }); if (chatLog.length > 30) chatLog.shift(); renderLobby(true); if (!inLobby) G.banner(`${d.n.slice(0, 14).replace(/[<>&]/g, '')}<small>${d.m.slice(0, 120).replace(/[<>&]/g, '')}</small>`, '', 3500); }
    else if (d.t === 'late' && !others.size) fail('Trop tard', 'On ne peut rejoindre un duel que pendant les cinq minutes qui suivent sa création. Demande un nouveau lien.');
    else if (d.t === 'dodge' && d.to === Net.id()) { G.showHit('Esquivé', 'soft', []).verdict.textContent = 'Il s\'est téléporté dans ton dos'; }
    else if (d.t === 'ko' && d.to === Net.id() && !over) {   // c'est la victime qui annonce le K.-O. : elle seule connaît sa santé
      score += d.pts === 2 ? 2 : 1; scoreKey = ''; Snd.levelUp();
      G.banner(`${d.pts === 2 ? 'Désintégré' : 'K.-O.'}<small>+${d.pts === 2 ? 2 : 1} · tu as ${score} sur ${GOAL}</small>`, '', 2400);
      if (score >= GOAL) { over = true; Net.send({ t: 'win', id: Net.id() }); G.whenCalm(() => endCard(true)); }
    }
    else if (d.t === 'brk' && 'trw'.includes(d.k) && num(d.dx) && num(d.dz)) G.breakThing(d.k, d.i | 0, d.dx, d.dz, true);   // l'autre a cassé quelque chose
    else if (d.t === 'brks' && Array.isArray(d.l)) for (const b of d.l.slice(0, 600)) { if (Array.isArray(b) && 'trw'.includes(b[0])) World.breakIt(b[0], b[1] | 0, +b[2] || 1, +b[3] || 0); }
  }

  /* ---------- chaque image : j'envoie mon état, je replace les autres ---------- */
  function update(dt, rdt) {
    const P = G.P, S = G.S;
    sendAcc += rdt;
    if (sendAcc > 0.066) {
      sendAcc = 0;
      Net.send({ t: 's', id: Net.id(), x: r2(P.x), y: r2(P.y || 0), z: r2(P.z), f: r2(P.face), c: P.crouch ? 1 : 0, ch: r2(P.chargePose), k: P.kick ? 1 : 0, sp: P.sprinting ? 1 : 0, h: P.hidden ? 1 : 0, inv: P.invuln > 0 ? 1 : 0, fl: P.fly ? 1 : 0, sc: score, tp: P.tpN || 0, hp: Math.round(G.S.hp), n: myName, g: Net.isHost ? GOAL : undefined });
    }
    if (joinUntil) {   // compte à rebours des inscriptions
      const left = joinUntil - Date.now();
      if (left <= 0) { joinUntil = 0; Net.lock(); $('invite').hidden = true; renderLobby(true); G.banner('Inscriptions closes<small>Plus personne ne peut rejoindre ce duel</small>', '', 3000); }
      else { const s = Math.ceil(left / 1000), t = `On peut rejoindre encore ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (t !== joinKey) { joinKey = t; $('invite-timer').textContent = t; } }
    }
    tickMeter(rdt);
    const now = performance.now(), k = 1 - Math.exp(-14 * rdt); let seen = false;
    for (const o of [...others.values()]) {
      if (now - o.seen > 6000) { drop(o.id); continue; }
      o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; o.z += (o.tz - o.z) * k; o.f += U.angDiff(o.f, o.tf) * k;
      o.cp = U.damp(o.cp, o.c, 12, rdt); o.kp = U.damp(o.kp, o.k, o.k ? 45 : 9, rdt); o.spk = U.damp(o.spk, o.sp, 7, rdt);
      const m = o.model; m.root.position.set(o.x, o.y, o.z); m.root.rotation.y = o.f;
      if (o.fl) m.pose.rotation.x += 12 * rdt; else m.pose.rotation.x = 0;
      Actors.animPlayer(m, { speed: o.fl ? 0 : Math.min(12, o.v), crouch: o.cp, charge: o.ch, kick: o.kp, sprint: o.spk, mega: false }, rdt, S.rt);
      // la règle du jeu : accroupi dans les herbes ou derrière un mur, l'autre disparaît de mon écran
      const d = Math.hypot(o.x - P.x, o.z - P.z);
      o.vis = !!o.fl || d < 2.6 || !(o.h || World.blocked(P.x, P.z, o.x, o.z, o.c > 0, Math.max(P.y, o.y)));
      m.root.visible = o.vis && !(o.inv && Math.floor(S.rt * 18) % 2 === 0);
      if (o.vis && d < 46) seen = true;
    }
    if (seen) sightHold = 2.5; else sightHold -= rdt;
    const mood = sightHold > 0 ? (seen ? 'alert' : 'sighted') : 'calm';
    if (mood !== S.mood) { S.mood = mood; Snd.setMood(mood); G.wrap.dataset.mood = mood; World.setMood(mood === 'calm' ? 0 : 1); }
    refresh();
  }
  function best() { let b = null; for (const o of others.values()) if (!b || o.sc > b.sc) b = o; return b; }
  function ranking() { return [{ name: myName, sc: score, me: true }].concat([...others.values()].map(o => ({ name: o.name || 'Adversaire', sc: o.sc || 0 }))).sort((a, b) => b.sc - a.sc || (a.me ? -1 : 1)); }
  function line() { return others.size ? ranking().map(r => `${r.name} ${r.sc}`).join(' · ') : 'En attente d\'un adversaire'; }
  function refresh() {
    const t = line() + '|' + GOAL; if (t === scoreKey) return; scoreKey = t; const el = $('duel-score'); el.textContent = '';
    const head = document.createElement('div'); head.className = 'ds-goal'; head.textContent = `Premier à ${GOAL}`; el.appendChild(head);
    if (!others.size) { const w = document.createElement('div'); w.className = 'ds-row'; w.textContent = 'En attente d\'un adversaire'; el.appendChild(w); return; }
    ranking().forEach((r, i) => { const row = document.createElement('div'); row.className = 'ds-row' + (r.me ? ' me' : '') + (i === 0 && r.sc > 0 ? ' lead' : ''); const n = document.createElement('span'); n.textContent = r.name; const s = document.createElement('b'); s.textContent = r.sc; row.append(n, s); el.appendChild(row); });
  }
  const hud = () => ({ eyebrow: `Duel · premier à ${GOAL}`, text: line(), k: score / GOAL });

  /* ---------- donner et recevoir ---------- */
  function kickTest(fx, fz, k) {
    if (over) return false;
    for (const o of others.values()) {
      if (o.fl || o.inv || Math.hypot(o.x - fx, o.z - fz) > 1.5 || Math.abs(o.y - G.P.y) > 2.8) continue;
      const S = G.S, back = Math.sin(o.f) * k.dx + Math.cos(o.f) * k.dz > 0.45, launch = k.c >= 0.5 || k.mega, sneaky = k.ambush || back;
      const lite = k.combo && k.combo < 4;
      if (lite) {   // coup de combo : peu de dégâts, mais la cible est bloquée tant que ça enchaîne
        const dm = 7; G.comboFx(o.x, o.z, k);
        Net.send({ t: 'hit', id: Net.id(), to: o.id, dx: r2(k.dx), dz: r2(k.dz), c: 0, launch: false, mega: false, dmg: dm, stun: 0.7, cb: k.combo });
        S.fury = Math.min(100, S.fury + 4); G.showHit('Combo ' + k.combo, 'soft', ['−' + dm]).verdict.textContent = k.combo === 3 ? 'Encore un : le final' : 'Enchaîne !';
        return true;
      }
      const dmg = k.mega ? 999 : k.combo === 4 ? 16 : Math.round((launch ? 22 + 26 * k.c : 9) * (sneaky ? 1.5 : 1) * (k.perfect ? 1.2 : 1));   // le final de combo projette mais ne fait pas plus mal qu'un coup moyen
      const tags = []; if (k.combo === 4) tags.push('Fin de combo'); if (k.ambush) tags.push('Embuscade'); if (back) tags.push('Dans le dos'); if (k.perfect) tags.push('Armé parfait'); if (k.mega) tags.push('Furie');
      G.impactFX(dummy(o.x, o.z), k, U.clamp(0.4 + 0.5 * k.c + (launch ? 0.25 : 0) + (k.mega ? 0.5 : 0), 0.3, 1.6), !!k.mega, launch);
      Net.send({ t: 'hit', id: Net.id(), to: o.id, dx: r2(k.dx), dz: r2(k.dz), c: r2(k.c), launch, mega: !!k.mega, dmg, cb: k.combo || 0 });
      if (k.mega) { S.fury = 0; G.fireRay(o.x, o.y + 1.2, o.z, k.dx, k.dz); }
      if (!k.mega) S.fury = Math.min(100, S.fury + (launch ? 18 : 6));
      const left = Math.max(0, (o.hp === undefined ? 100 : o.hp) - dmg);
      G.showHit(k.mega ? 'Désintégré' : !launch ? 'Touché' : sneaky ? 'Chassé surprise' : 'Chassé', k.mega ? 'mega' : launch ? '' : 'soft', tags.concat(k.mega ? 'Fatal' : '−' + dmg)).verdict.textContent = k.mega || left <= 0 ? 'K.-O.' : `Il lui reste ${left} de santé`;
      return true;
    }
    return false;
  }
  function takeHit(d) {
    const P = G.P; if (P.fly || !num(d.dx) || !num(d.dz)) return;
    const l = Math.hypot(d.dx, d.dz) || 1, dx = d.dx / l, dz = d.dz / l;
    const a = others.get(d.id);
    if (a && G.tryDodge({ x: a.x, z: a.z, f: a.f, rad: 0.6 })) { Net.send({ t: 'dodge', id: Net.id(), to: d.id }); return; }
    G.stopCharge(); P.kick = null;
    const cb = num(d.cb) ? U.clamp(d.cb | 0, 0, 4) : 0;
    if (num(d.stun)) G.comboFx(P.x, P.z, { dx, dz, combo: cb || 1 }); else G.impactFX(dummy(P.x, P.z), { dx, dz, combo: cb }, d.launch ? 1.1 : 0.5, !!d.mega, false);
    const el = $('hurt'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    if (d.mega) G.fireRay(P.x, (P.y || 0) + 1.2, P.z, dx, dz, true);
    const S = G.S; S.hp = d.mega ? 0 : Math.max(0, S.hp - (num(d.dmg) ? U.clamp(d.dmg, 0, 999) : 20));
    if (S.hp <= 0) {   // K.-O. : je l'annonce, je pars en vol, je reviens à neuf
      const pts = d.mega ? 2 : 1; Net.send({ t: 'ko', id: Net.id(), to: d.id, pts });
      P.fly = { t: 0, vx: dx * 22, vz: dz * 22, vy: 16, by: d.id, ko: true }; P.crouch = false; $('t-crouch').classList.remove('on');
      G.showHit(d.mega ? 'Désintégré' : 'K.-O.', 'soft', []).verdict.textContent = 'Tu réapparais dans un instant';
    } else if (d.launch) {   // projeté mais debout : Téléport pendant le vol pour contre-attaquer
      P.fly = { t: 0, vx: dx * 17, vz: dz * 17, vy: 12, by: d.id }; P.crouch = false; $('t-crouch').classList.remove('on');
      G.showHit('Projeté', 'soft', ['−' + Math.round(d.dmg || 0)]).verdict.textContent = 'Téléport pour revenir dans son dos';
    } else if (num(d.stun)) {   // pris dans un combo : impossible de bouger ou de frapper. Seul Téléport en sort.
      P.vx = dx * 4; P.vz = dz * 4; P.hurtT = U.clamp(d.stun, 0, 1);
      G.showHit('Combo subi', 'soft', ['−' + Math.round(d.dmg || 0)]).verdict.textContent = 'Téléport pour t\'en sortir';
    } else { P.vx = dx * 13; P.vz = dz * 13; P.hurtT = 0.4; }
  }
  // le vol plané de celui qui vient d'en prendre un
  function flyStep(dt) {
    const P = G.P, f = P.fly; f.t += dt; P.x += f.vx * dt; P.z += f.vz * dt; P.y = Math.max(0, (P.y || 0) + f.vy * dt); f.vy -= 22 * dt; clamp(P);
    if (dt > 0) FX.trail(P.x, P.y + 1, P.z, false);
    // projeté dans le décor : on passe à travers en le cassant, ça freine et ça fait un peu mal (jamais mortel)
    if (f.t > 0.06 && (f.hits || 0) < 3) {
      const th = World.hitScenery(P.x, P.z, P.y);
      if (th) {
        f.hits = (f.hits || 0) + 1; const S = G.S, sp = Math.hypot(f.vx, f.vz) || 1;
        if (th.solid) { f.vx *= -0.25; f.vz *= -0.25; f.hits = 3; Snd.thud(); } else { G.breakThing(th.kind, th.i, f.vx / sp, f.vz / sp); f.vx *= 0.72; f.vz *= 0.72; }
        if (!f.ko) S.hp = Math.max(1, S.hp - 6); FX.shake(0.5); const p = G.project(P.x, P.y + 2, P.z); G.floatText(th.kind === 't' ? 'Arbre fauché' : th.kind === 'r' ? 'Rocher éclaté' : 'Mur traversé', p.x, p.y, 'red');
      }
    }
    if (!f.ko && f.t > 0.3 && f.vy < 0 && P.y <= World.groundAt(P.x, P.z, P.y)) {   // simple projection : on retombe et on continue
      P.fly = null; P.y = World.groundAt(P.x, P.z, P.y); P.vy = 0; P.hurtT = 0.3; P.vx = f.vx * 0.3; P.vz = f.vz * 0.3; G.pm.pose.rotation.x = 0; FX.dust(P.x, P.z, 12, 6); Snd.thud(); return;
    }
    if (f.ko && f.t > 1.6) {
      const a = others.get(f.by); let bi = 0, bd = -1;
      SPAWNS.forEach((s, i) => { const dd = a ? Math.hypot(s[0] - a.x, s[1] - a.z) : Math.random(); if (dd > bd) { bd = dd; bi = i; } });
      place(bi); P.invuln = 2.5; G.S.stamina = G.S.maxStamina; G.S.hp = 100;
    }
  }
  function clamp(o) { const dx = o.x - ARENA.x, dz = o.z - ARENA.z, d = Math.hypot(dx, dz); if (d > ARENA.r) { o.x = ARENA.x + dx / d * ARENA.r; o.z = ARENA.z + dz / d * ARENA.r; } }
  function endCard(won, winner) {
    const rk = ranking().map((r, i) => `${i + 1}. ${r.name} : ${r.sc}`);
    G.card({ eyebrow: 'Duel terminé · premier à ' + GOAL, title: won ? 'Victoire' : (winner ? winner + ' gagne' : 'Défaite'), paras: [won ? 'Tes adversaires sont partis voir les montagnes de près.' : 'Tu as vu les montagnes de près. Cache-toi mieux, frappe dans le dos.'].concat(rk), button: 'Revanche' }, () => { Net.send({ t: 'again' }); reset(); });
  }
  function reset() { score = 0; over = false; for (const o of others.values()) o.sc = 0; place(spawnIndex()); G.P.invuln = 2; G.S.fury = 0; G.S.hp = 100; scoreKey = ''; }

  // par-dessus la 3D : étiquette de l'adversaire visible, flèche s'il est hors champ ou s'il fait du bruit
  function bubble(g, x, y, b) {
    const age = (performance.now() - b.t) / 1000; if (age > 3.2) return false;
    g.save(); g.globalAlpha = Math.min(1, (3.2 - age) * 2); g.font = '700 15px "Barlow Condensed", "Arial Narrow", sans-serif'; const tw = g.measureText(b.m).width + 18, by = y - 30 - Math.min(1, age * 6) * 6;
    g.fillStyle = '#fff3d4'; g.strokeStyle = '#1b140c'; g.lineWidth = 2; g.beginPath(); g.roundRect ? g.roundRect(x - tw / 2, by - 13, tw, 26, 8) : g.rect(x - tw / 2, by - 13, tw, 26); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(x - 6, by + 12); g.lineTo(x, by + 20); g.lineTo(x + 6, by + 12); g.fill(); g.fillStyle = '#1b140c'; g.fillText(b.m, x, by + 1); g.restore(); return true;
  }
  function draw(g, w, h) {
    const P = G.P;
    if (myBubble) { const p = G.project(P.x, (P.y || 0) + 3, P.z); if (!p.on || !bubble(g, p.x, p.y, myBubble)) { if ((performance.now() - myBubble.t) > 3200) myBubble = null; } }
    for (const o of others.values()) {
      if (!o.vis) continue;
      const p = G.project(o.x, o.y + 2.9, o.z);
      if (p.on) {
        g.font = '700 14px "Barlow Condensed", "Arial Narrow", sans-serif'; g.lineWidth = 3; g.strokeStyle = '#1b140c'; const lab = (o.name || 'Adversaire').toUpperCase() + (o.talk ? '  ◉ parle' : ''); g.strokeText(lab, p.x, p.y); g.fillStyle = '#ff8a6a'; g.fillText(lab, p.x, p.y);
        if (o.bubble && !bubble(g, p.x, p.y, o.bubble)) o.bubble = null;
        const hp = o.hp === undefined ? 100 : o.hp, bw = 56; g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(p.x - bw / 2 - 1, p.y + 9, bw + 2, 7); g.fillStyle = hp > 30 ? '#7fd85a' : '#ff4f3a'; g.fillRect(p.x - bw / 2, p.y + 10, bw * hp / 100, 5);
      }
    }
  }

  // l'adversaire arme ou frappe tout près : il y a de quoi se téléporter
  function nearest() { const P = G.P; let b = null, bd = 1e9; for (const o of others.values()) { if (o.fl || o.h || !o.vis) continue; const d = Math.hypot(o.x - P.x, o.z - P.z); if (d < bd) { bd = d; b = o; } } return b ? { x: b.x, z: b.z, f: b.f, rad: 0.6 } : null; }

  /* ---------- salon d'attente ---------- */
  let inLobby = false, started = false, lobbyKey = '';
  const chatLog = [];
  function openLobby() {
    inLobby = true; started = false; G.S.modal = true; $('lobby').hidden = false;
    if (!micStream) { micState('off', 'Micro pas encore activé'); if (inApp) micHelp('inapp'); }
    if (role === 'host') { const inv = $('invite'); $('lobby-invite').appendChild(inv); inv.hidden = true; }
    renderLobby(true);
  }
  function renderLobby(force) {
    if (!inLobby) return;
    const list = [{ name: myName, me: true, talk: talking }].concat([...others.values()].map(o => ({ name: o.name || '…', talk: o.talk })));
    const key = list.map(p => p.name + (p.talk ? '*' : '')).join('|') + chatLog.length + (role === 'host' && !$('invite').hidden);
    if (!force && key === lobbyKey) return; lobbyKey = key;
    const ul = $('lobby-players'); ul.textContent = '';
    list.forEach(p => { const li = document.createElement('li'); li.className = (p.me ? 'me' : '') + (p.talk ? ' talk' : ''); const n = document.createElement('span'); n.textContent = p.name + (p.me ? ' (toi)' : ''); const st = document.createElement('em'); st.textContent = p.talk ? 'parle' : 'prêt'; li.append(n, st); ul.appendChild(li); });
    const n = list.length; $('lobby-status').textContent = n < 2 ? 'En attente d\'au moins un autre joueur…' : `${n} joueurs prêts. N'importe qui peut lancer la partie.`;
    $('lobby-start').disabled = n < 2;
    const log = $('lobby-chat-log'); log.textContent = '';
    chatLog.slice(-6).forEach(m => { const p = document.createElement('p'); const b = document.createElement('b'); b.textContent = m.n + ' : '; p.append(b, document.createTextNode(m.m)); log.appendChild(p); });
  }
  function pressStart() { if (!inLobby || others.size < 1) return; Net.send({ t: 'start', id: Net.id() }); beginCountdown(); }
  function spawnIndex() { const ids = [Net.id()].concat([...others.keys()]).sort((a, b) => a === 'h' ? -1 : b === 'h' ? 1 : a < b ? -1 : 1); return ids.indexOf(Net.id()); }
  // 3, 2, 1… chez tout le monde, puis tout le monde part en même temps
  function beginCountdown() {
    if (started) return; started = true; inLobby = false; $('lobby').hidden = true; $('invite').hidden = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (Net.isHost) { Net.lock(); joinUntil = 0; }
    score = 0; over = false; for (const o of others.values()) o.sc = 0; place(spawnIndex()); G.P.invuln = 0; G.S.fury = 0; G.S.hp = 100; scoreKey = '';
    const el = $('countdown'); let n = 3;
    const tick = () => {
      el.hidden = false; el.textContent = n > 0 ? String(n) : 'Chassé !'; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      if (n > 0) { Snd.combo(1); n--; setTimeout(tick, 900); }
      else { Snd.combo(4); G.S.modal = false; setTimeout(() => { el.hidden = true; }, 800); }
    };
    tick();
  }
  function sendChat() {
    const inp = $('lobby-chat-input'), m = inp.value.replace(/\s+/g, ' ').trim().slice(0, 120); if (!m) return;
    inp.value = ''; chatLog.push({ n: myName, m }); Net.send({ t: 'chat', id: Net.id(), n: myName, m }); renderLobby(true);
  }

  /* ---------- voix : on maintient le micro, tout le monde entend ---------- */
  let micStream = null, micHeld = false, talking = false, micAsk = null;
  const outCalls = new Map(), audios = new Map();
  function setTalk(on) {
    talking = on; if (micStream) micStream.getAudioTracks().forEach(t => { t.enabled = on; });
    Net.send({ t: 'talk', id: Net.id(), on: !!on }); document.querySelectorAll('[data-mic]').forEach(b => b.classList.toggle('on', on)); renderLobby();
  }
  /* ---------- réglage du micro : demandé dès l'arrivée, état visible, aide selon le téléphone ---------- */
  const UA = navigator.userAgent, isAndroid = /Android/i.test(UA), isIOS = /iP(hone|od|ad)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /; wv\)|FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|MicroMessenger|GSA\//i.test(UA);
  let openMic = false, meter = null;
  function micState(st, txt) { const el = $('mic-status'); el.textContent = txt; el.dataset.state = st; $('mic-enable').hidden = st === 'on'; $('mic-open-row').hidden = st !== 'on'; }
  function micHelp(kind) {
    const H = {
      inapp: ['Le lien est ouvert dans le navigateur d\'une appli (WhatsApp, Messenger…), qui ne donne pas accès au micro.', isIOS ? 'Touche les trois points ou l\'icône boussole, puis « Ouvrir dans Safari ».' : 'Touche le menu ⋮ en haut à droite, puis « Ouvrir dans Chrome ». Tu reviendras directement dans le salon.'],
      denied: isIOS
        ? ['Le micro est bloqué pour ce site.', 'Dans Safari, touche « aA » à gauche de l\'adresse, puis « Réglages du site web » → Micro → Autoriser. Ou : Réglages de l\'iPhone → Safari → Micro → Autoriser. Puis touche Recharger.']
        : ['Le micro est bloqué pour ce site : le téléphone ne reposera plus la question tout seul.', 'Touche le cadenas (ou l\'icône de réglages) à gauche de l\'adresse → Autorisations → Micro → Autoriser. Puis touche Recharger : tu reviendras dans le salon.'],
      nomic: ['Aucun micro n\'a été trouvé sur cet appareil.', 'Branche un casque avec micro, puis réessaie.'],
      busy: ['Le micro est déjà utilisé par une autre appli (appel, dictée, enregistreur…).', 'Ferme-la, puis touche « Activer le micro ».'],
      insecure: ['Ce navigateur ne donne pas accès au micro.', isAndroid ? 'Ouvre le lien dans Chrome.' : 'Ouvre le lien dans Safari ou Chrome.'],
    }[kind];
    const box = $('mic-help'); box.hidden = !H; if (!H) return;
    $('mic-help-what').textContent = H[0]; $('mic-help-how').textContent = H[1]; $('mic-reload').hidden = kind !== 'denied';
  }
  async function enableMic() {
    if (micStream) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) { micState('off', 'Micro indisponible'); micHelp(inApp ? 'inapp' : 'insecure'); return false; }
    try { if (navigator.permissions && navigator.permissions.query) { const p = await navigator.permissions.query({ name: 'microphone' }); if (p.state === 'denied') { micState('off', 'Micro bloqué'); micHelp(inApp ? 'inapp' : 'denied'); return false; } } } catch (_) { /* ce navigateur ne sait pas répondre : on demande quand même */ }
    micState('wait', 'Autorise le micro dans la fenêtre du téléphone…');
    try { micAsk = micAsk || navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); micStream = await micAsk; }
    catch (e) {
      micAsk = null; const n = e && e.name;
      if (n === 'NotFoundError' || n === 'OverconstrainedError') { micState('off', 'Pas de micro'); micHelp('nomic'); }
      else if (n === 'NotReadableError' || n === 'AbortError') { micState('off', 'Micro occupé'); micHelp('busy'); }
      else { micState('off', 'Micro refusé'); micHelp(inApp ? 'inapp' : 'denied'); }
      return false;
    }
    micStream.getAudioTracks().forEach(t => { t.enabled = openMic; });
    micState('on', 'Micro prêt'); micHelp(null); startMeter(); callAll();
    return true;
  }
  function callAll() { if (!micStream) return; for (const id of others.keys()) if (!outCalls.has(id)) { const c = Net.call(id, micStream); if (c) { outCalls.set(id, c); c.on('close', () => outCalls.delete(id)); c.on('error', () => outCalls.delete(id)); } } }
  // petit vumètre : on voit tout de suite que le micro capte
  function startMeter() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext, ac = new AC(), an = ac.createAnalyser(); an.fftSize = 256;
      ac.createMediaStreamSource(micStream).connect(an); const buf = new Uint8Array(an.fftSize);
      meter = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); return m / 128; };
      if (ac.state === 'suspended') ac.resume();
      addEventListener('pointerdown', () => { if (ac.state === 'suspended') ac.resume(); });
    } catch (_) { meter = null; }
  }
  let meterK = 0;
  function tickMeter(rdt) {
    if (!meter) return; const lv = meter(); meterK = Math.max(lv, meterK - rdt * 1.5);
    const live = talking || openMic, w = Math.round(Math.min(1, meterK * 2.2) * 100) + '%';
    $('mic-level-fill').style.width = w; $('mic-level').classList.toggle('live', live);
    document.querySelectorAll('[data-mic]').forEach(b => b.style.setProperty('--lv', live ? Math.min(1, meterK * 2.2) : 0));
  }
  function setOpenMic(on) { openMic = on; if (micStream) { if (on) setTalk(true); else if (!micHeld) setTalk(false); } }

  /* ---------- cris : quatre phrases toutes prêtes, en bulle au-dessus de la tête ---------- */
  const SHOUTS = ['Viens là !', 'Trop facile', 'Aïe aïe aïe', 'Revanche ?', 'Bien joué', 'Je suis caché…'];
  let myBubble = null;
  function shout(i) {
    const m = SHOUTS[i]; if (!m) return; Snd.ui(); myBubble = { m, t: performance.now() };
    chatLog.push({ n: myName, m }); Net.send({ t: 'chat', id: Net.id(), n: myName, m, s: 1 }); renderLobby(true); $('shouts').hidden = true;
  }
  async function micDown() {
    micHeld = true;
    if (!micStream && !(await enableMic())) { if (!inLobby) G.banner($('mic-status').textContent + '<small>' + ($('mic-help-how').textContent || 'Autorise le micro pour ce site').replace(/[<>&]/g, '') + '</small>', 'red', 6000); return; }
    callAll();
    if (micHeld) setTalk(true);
  }
  function micUp() { micHeld = false; if (talking && !openMic) setTalk(false); }
  function onCall(c) {
    try { c.answer(); } catch (_) { return; }
    c.on('stream', st => {
      const id = Net.gameId(c.peer); let a = audios.get(id);
      if (!a) { a = document.createElement('audio'); a.autoplay = true; a.setAttribute('playsinline', ''); document.body.appendChild(a); audios.set(id, a); }
      a.srcObject = st; const p = a.play(); if (p && p.catch) p.catch(() => { });
    });
  }
  let shareText = () => '';
  function setName(n) { myName = n; scoreKey = ''; }
  function setGoal(g) { if ([5, 11, 21].includes(g)) { GOAL = g; scoreKey = ''; } }
  function threat() { const P = G.P; for (const o of others.values()) { if (o.fl) continue; if ((o.ch > 0.25 || o.k) && Math.hypot(o.x - P.x, o.z - P.z) < 7) return { x: o.x, z: o.z, f: o.f, rad: 0.6 }; } return null; }
  return { init, start, update, hud, kickTest, threat, nearest, setName, setGoal, enableMic, flyStep, clamp, draw, get others() { return others; }, get score() { return score; } };
})();
