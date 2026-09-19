(() => {
  "use strict";
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const FRAG = `
  precision highp float;
  uniform vec2 u_res; uniform float u_time; uniform vec3 u_size; uniform vec2 u_mouse; uniform float u_amber; uniform vec3 u_door; uniform sampler2D u_logo;
  #define I 100
  mat3 rotY(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}
  float sdBox(vec3 p, vec3 b, float r){vec3 q=abs(p)-b+vec3(r);return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0)-r;}
  float mapBox(vec3 p){return sdBox(p,u_size,0.06);}
  float map(vec3 p){float g=p.y+u_size.y+0.002;return min(g, mapBox(p));}
  vec3 nrm(vec3 p){vec2 e=vec2(0.0016,0.);return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}
  float shadow(vec3 ro, vec3 rd){float r=1.0,t=0.03;for(int i=0;i<26;i++){float h=map(ro+rd*t);if(h<0.001)return 0.0;r=min(r,11.0*h/t);t+=clamp(h,0.03,0.5);if(t>16.0)break;}return clamp(r,0.0,1.0);}
  float ao(vec3 p, vec3 n){float o=0.,s=1.;for(int i=0;i<5;i++){float h=0.03+0.14*float(i);o+=(h-map(p+n*h))*s;s*=0.72;}return clamp(1.0-1.6*o,0.0,1.0);}
  vec3 sky(vec3 rd){float t=clamp(rd.y*0.5+0.5,0.0,1.0);vec3 c=mix(vec3(0.97,0.965,0.95),vec3(0.72,0.82,0.92),pow(t,0.8));c+=vec3(1.0,0.94,0.72)*pow(max(1.0-abs(rd.y),0.0),8.0)*0.05;return c;}
  vec3 mat(vec3 p, vec3 n){
    // Mule Box livery: smooth white body, logo decal on the long sides,
    // brand-coloured roll-up door on the end face
    vec3 base=vec3(0.93,0.925,0.915);
    base*= (abs(n.y)<0.6)? 0.975 : 0.99;
    // logo on both length faces (|n.z|), aspect 3.5:1 like /logo.png
    float side=step(0.6,abs(n.z));
    float W=min(u_size.y*0.72*3.5, u_size.x*1.72);
    float H=W/3.5;
    vec2 uv=vec2(p.x/W+0.5, (p.y-u_size.y*0.10)/H+0.5);
    uv.x=mix(uv.x, 1.0-uv.x, step(0.0,n.z));           // unmirror per face (screen-right = -x here)
    float inuv=step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0);
    vec4 logo=texture2D(u_logo, clamp(uv,0.0,1.0));
    base=mix(base, logo.rgb, logo.a*side*inuv);
    // roll-up door on the +x end: horizontal slats inside a white frame.
    // u_door is the brand primary colour gofuse returns for this site.
    float end=step(0.6,n.x);
    float doorz=step(abs(p.z),u_size.z*0.84);
    float doory=step(abs(p.y+u_size.y*0.05),u_size.y*0.86);
    float door=end*doorz*doory;
    float slat=0.90+0.10*cos(p.y*46.0);
    base=mix(base, u_door*slat, door);
    return base;
  }
  void main(){
    vec2 uv=(gl_FragCoord.xy-0.5*u_res)/u_res.y;
    float ry=u_time*0.14 + u_mouse.x*0.5;
    float pit=0.34 - u_mouse.y*0.12;
    vec3 ro=vec3(0.0,0.0,8.8);
    ro=rotY(ry)*ro; ro.y=3.2*sin(pit);
    vec3 ta=vec3(0.0,-0.2,0.0);
    vec3 f=normalize(ta-ro), rgt=normalize(cross(vec3(0,1,0),f)), up=cross(f,rgt);
    vec3 rd=normalize(uv.x*rgt+uv.y*up+1.5*f);
    float t=0.0; float hit=-1.0;
    for(int i=0;i<I;i++){vec3 p=ro+rd*t;float d=map(p);if(d<0.001){hit=t;break;}t+=d;if(t>40.0)break;}
    vec3 col=sky(rd);
    if(hit>0.0){
      vec3 p=ro+rd*hit; vec3 n=nrm(p);
      bool isBox = mapBox(p) < 0.02;
      vec3 alb = isBox ? mat(p,n) : vec3(0.80,0.79,0.77);
      vec3 L=normalize(vec3(-0.5,0.82,0.42));
      float sh=shadow(p+n*0.02,L);
      float dif=max(dot(n,L),0.0)*sh;
      float occ=ao(p,n);
      vec3 lit = alb*(vec3(0.52,0.55,0.60)*occ + dif*vec3(1.05,1.0,0.92));
      // soft warm bounce from behind (was the amber rim)
      vec3 A=normalize(vec3(0.62,0.28,-0.7));
      lit += alb*max(dot(n,A),0.0)*vec3(1.0,0.92,0.70)*0.22*u_amber;
      vec3 h=normalize(L-rd);
      lit += pow(max(dot(n,h),0.0),46.0)*vec3(1.0,0.95,0.8)*sh*(isBox?0.6:0.12);
      float fr=pow(1.0-max(dot(n,-rd),0.0),3.5);
      lit += fr*vec3(0.80,0.87,0.95)*0.28;
      float fog=1.0-exp(-hit*hit*0.0016);
      col=mix(lit, sky(rd)*0.85, fog);
    }
    col += vec3(1.0,0.98,0.92)*pow(max(1.0-length(uv+vec2(0.35,0.1)),0.0),2.4)*0.05;
    float g=fract(sin(dot(gl_FragCoord.xy,vec2(12.99,78.23)))*43758.5)-0.5;
    col+=g*0.012;
    gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
  }`;
  const VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

  function makeRenderer(canvas, opts) {
    if (!canvas) return null;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) return null;
    const sh = (t, s) => {
      const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o);
      if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.warn(gl.getShaderInfoLog(o)); return o;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); return null; }
    gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const logoImg = new Image();
    logoImg.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, logoImg);
    };
    logoImg.src = opts.logo || "/logo.png";
    gl.uniform1i(U("u_logo"), 0);
    const u = { res: U("u_res"), time: U("u_time"), size: U("u_size"), mouse: U("u_mouse"), amber: U("u_amber"), door: U("u_door") };
    const state = { size: opts.size.slice(), tsize: opts.size.slice(), mouse: [0, 0], tmouse: [0, 0], amber: opts.amber || 1, door: opts.door || [0.545, 0.133, 0.208], vis: true, t0: performance.now() };
    const dpr = () => Math.min(devicePixelRatio || 1, 1.9);
    function resize() {
      const r = canvas.getBoundingClientRect(); const w = Math.max(1, r.width * dpr()), h = Math.max(1, r.height * dpr());
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    }
    function frame(now) {
      if (!state.vis) { requestAnimationFrame(frame); return; }
      resize();
      for (let i = 0; i < 3; i++) state.size[i] += (state.tsize[i] - state.size[i]) * 0.12;
      for (let i = 0; i < 2; i++) state.mouse[i] += (state.tmouse[i] - state.mouse[i]) * 0.06;
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, RM ? 1.4 : (now - state.t0) / 1000);
      gl.uniform3f(u.size, state.size[0], state.size[1], state.size[2]);
      gl.uniform2f(u.mouse, state.mouse[0], state.mouse[1]);
      gl.uniform1f(u.amber, state.amber);
      gl.uniform3f(u.door, state.door[0], state.door[1], state.door[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    new IntersectionObserver(es => { state.vis = es[0].isIntersecting; }, { threshold: 0.02 }).observe(canvas);
    return { setSize: (s) => state.tsize = s.slice(), setMouse: (x, y) => { state.tmouse = [x, y]; } };
  }
  // ── Quote panel ───────────────────────────────────────────────────────────
  // Everything rendered below comes from window.__QX_DATA, which the server
  // built from the gofuse config + preview responses. Amounts are CENTS,
  // exactly as gofuse returns them, and are formatted only at display time.
  //
  // There are deliberately no fallback prices, fee tables or surcharges here.
  // When gofuse has no number for something the panel says so; inventing a
  // plausible figure on a quote page is worse than showing none.
  // Stylised proportions for the 3D box: every Mule Box is 8ft wide and tall,
  // so only the length varies.
  const sizeFor = ft => [(ft / 8) * 1.25, 1.25, 1.25];

  const DATA = (typeof window !== "undefined" && window.__QX_DATA) || null;
  const SERVICES = (DATA && DATA.services) || [];
  const LENGTHS = (DATA && DATA.lengths) || [];
  const LABELS = (DATA && DATA.labels) || {};

  // The shader writes straight to gl_FragColor with no gamma step, so the sRGB
  // channels go through unconverted.
  const hexToRgb = hex => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  const boxR = makeRenderer(document.getElementById("gl-box"), {
    size: sizeFor((DATA && DATA.initial && DATA.initial.lengthFt) || 16),
    amber: 0.9,
    // Roll-up door in the brand red gofuse holds for this site.
    door: hexToRgb(DATA && DATA.brand && DATA.brand.primaryColor) || [0.545, 0.133, 0.208],
    logo: (DATA && DATA.logo) || "/logo.png",
  });

  const money = cents => (cents / 100).toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
  });
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = id => document.getElementById(id);

  const serviceBySlug = slug => SERVICES.find(s => s.slug === slug) || null;
  const productAt = (svc, ft) => (svc ? svc.products.find(p => p.lengthFt === ft) || null : null);
  const lengthsOf = svc => (svc ? svc.products.map(p => p.lengthFt).filter(n => n != null).sort((a, b) => a - b) : []);

  const _cs = document.querySelector('input[name="size"]:checked');
  const _cv = document.querySelector('input[name="svc"]:checked');
  const state = {
    size: _cs ? +_cs.value : (DATA && DATA.initial && DATA.initial.lengthFt) || LENGTHS[0] || null,
    svc: _cv ? _cv.value : (DATA && DATA.initial && DATA.initial.service) || (SERVICES[0] && SERVICES[0].slug) || null,
  };

  const tweenIds = new WeakMap();
  // Tweens the digits inside a formatted money string, leaving the currency
  // symbol and any surrounding words in place.
  function tweenMoney(el, toCents, wrap) {
    const render = c => (wrap ? wrap(money(c)) : money(c));
    const from = Math.round(parseFloat(String(el.textContent).replace(/[^0-9.]/g, "")) * 100);
    if (RM || !Number.isFinite(from)) { el.textContent = render(toCents); return; }
    const id = (tweenIds.get(el) || 0) + 1;
    tweenIds.set(el, id);
    const t0 = performance.now(), dur = 520;
    (function step(now) {
      if (tweenIds.get(el) !== id) return;
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = render(Math.round(from + (toCents - from) * e));
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  // Size options are per-service: gofuse can stock a length under Keep It that
  // Store It does not carry, and price a shared length differently.
  function updateSizeOptions() {
    const svc = serviceBySlug(state.svc);
    const offered = lengthsOf(svc);
    document.querySelectorAll('input[name="size"]').forEach(input => {
      const ft = +input.value;
      const product = productAt(svc, ft);
      const ok = !!product;
      input.disabled = !ok;
      input.title = ok ? "" : "Not available for the selected service";
      const opt = input.closest(".opt");
      if (opt) opt.classList.toggle("unavailable", !ok);
      // Name and dimensions come from the product this service actually sells.
      const box = opt && opt.querySelector(".box");
      if (box && product) {
        const k = box.querySelector(".k"), s = box.querySelector(".s");
        if (k) k.textContent = product.name;
        if (s) {
          s.textContent = [product.dimensions, product.cuft ? product.cuft.toLocaleString() + " ft³" : null]
            .filter(Boolean).join(" · ");
        }
      }
    });
    return offered;
  }

  // Keep the selected length on a size this service can actually price,
  // preferring the same-or-smaller box before falling back to the smallest.
  function syncSizeForSvc() {
    const offered = lengthsOf(serviceBySlug(state.svc));
    if (!offered.length || offered.includes(state.size)) return;
    state.size = offered.filter(ft => ft <= state.size).pop() ?? offered[0];
    const radio = document.querySelector(`input[name="size"][value="${state.size}"]`);
    if (radio) radio.checked = true;
  }

  function renderUnavailable(svc) {
    $("lines").innerHTML =
      '<div class="li"><div class="name">Pricing unavailable' +
      '<small>We could not load live pricing for this option.</small></div>' +
      '<div class="amt">Call for pricing</div></div>';
    $("transit-lines").innerHTML = "";
    const feesRow = $("fees-total-row");
    if (feesRow) feesRow.style.display = "none";
    const sec = $("transit-sec");
    if (sec) sec.style.display = "none";
    $("due-total").textContent = "—";
    $("then-mo").textContent = "";
    $("capacity").textContent = "";
    $("sku").textContent = svc ? svc.name : "";
  }

  function render() {
    const svc = serviceBySlug(state.svc);
    const product = productAt(svc, state.size);
    if ($("svc-label")) $("svc-label").textContent = svc ? svc.name : "";
    if ($("products-label") && LABELS.products) $("products-label").textContent = LABELS.products;
    if ($("fees-label") && LABELS.fees) $("fees-label").textContent = LABELS.fees;
    if ($("due-label") && LABELS.total) $("due-label").textContent = LABELS.total;

    if (!svc || !product) { renderUnavailable(svc); return; }

    $("sku").textContent = [product.name, svc.name].filter(Boolean).join(" · ");
    $("capacity").textContent = product.idealFor[0] || "";
    $("tag-h").textContent = "8'";
    $("tag-l").textContent = product.lengthFt ? product.lengthFt + "'" : "";
    $("tag-v").textContent = product.cuft ? product.cuft.toLocaleString() + " ft³" : "";
    if (boxR && product.lengthFt) boxR.setSize(sizeFor(product.lengthFt));

    // Monthly recurring: the product price plus any recurring fee gofuse
    // returned for this service. Both straight from the API.
    const rows = [];
    const badge = product.discountLabel || LABELS.discountBadge;
    const priceHtml =
      (product.originalPrice ? `<span class="was">${money(product.originalPrice)}</span>` : "") +
      `${money(product.price)}<em>/mo</em>` +
      (product.originalPrice && badge ? `<span class="badge">${escapeHtml(badge)}</span>` : "");
    const detail = [product.dimensions, product.cuft ? product.cuft.toLocaleString() + " ft³" : null]
      .filter(Boolean).join(" · ");
    rows.push(
      `<div class="li"><div class="name">${escapeHtml(product.name)}<small>${escapeHtml(detail)}</small></div>` +
      `<div class="amt">${priceHtml}</div></div>`,
    );
    for (const fee of svc.recurringFees) {
      rows.push(
        `<div class="li"><div class="name">${escapeHtml(fee.name)}</div>` +
        `<div class="amt">${money(fee.amount)}<em>/mo</em></div></div>`,
      );
    }
    $("lines").innerHTML = rows.join("");

    // One-time transit legs. gofuse decides both whether a leg is an estimate
    // ("Starting at") and whether it counts toward the up-front total.
    const sec = $("transit-sec");
    if (sec) sec.style.display = svc.transitFees.length ? "" : "none";
    $("transit-lines").innerHTML = svc.transitFees.map(t => {
      const amt = t.startingAt ? `Starting at ${money(t.amount)}` : money(t.amount);
      return `<div class="li muted"><div class="name">${escapeHtml(t.name)}</div><div class="amt">${amt}</div></div>`;
    }).join("");

    const feesRow = $("fees-total-row");
    if (feesRow) {
      feesRow.style.display = svc.excludedOneTime > 0 ? "" : "none";
      $("fees-total").textContent = money(svc.excludedOneTime);
    }

    // The discount gofuse applies is first-month-only, so the up-front total
    // uses the discounted price while the "then" line quotes the full rate.
    const monthly = product.price + svc.recurringTotal;
    const ongoing = (product.originalPrice ?? product.price) + svc.recurringTotal;
    tweenMoney($("due-total"), monthly + svc.includedOneTime);
    tweenMoney($("then-mo"), ongoing, s => `then ${s}/mo`);
  }

  document.querySelectorAll('input[name="size"]').forEach(i =>
    i.addEventListener("change", e => { state.size = +e.target.value; render(); }));
  document.querySelectorAll('input[name="svc"]').forEach(i =>
    i.addEventListener("change", e => {
      state.svc = e.target.value;
      syncSizeForSvc();
      updateSizeOptions();
      render();
    }));

  document.querySelectorAll("[data-count]").forEach(el => {
    const to = +el.dataset.count, suf = el.dataset.suffix || "";
    if (RM) { el.textContent = to.toLocaleString() + suf; return; }
    const io = new IntersectionObserver(es => {
      if (!es[0].isIntersecting) return; io.disconnect();
      const t0 = performance.now(), dur = 1200;
      (function s(n) {
        const k = Math.min(1, (n - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(to * e).toLocaleString() + suf; if (k < 1) requestAnimationFrame(s);
      })(performance.now());
    }, { threshold: 0.6 });
    io.observe(el);
  });

  syncSizeForSvc();
  updateSizeOptions();
  render();
})();
