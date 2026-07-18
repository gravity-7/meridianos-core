document.addEventListener('DOMContentLoaded', () => {
    // --- Setup Scene Elements ---

    // Scene 1: Chaos Particles
    const chaosContainer = document.getElementById('chaos-particles');
    const numParticles = 100;
    const particles = [];
    for (let i = 0; i < numParticles; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        
        // Random initial position and rotation
        gsap.set(p, {
            x: Math.random() * window.innerWidth,
            y: Math.random() * window.innerHeight,
            rotation: Math.random() * 360,
            opacity: Math.random() * 0.5 + 0.2
        });
        
        chaosContainer.appendChild(p);
        particles.push(p);

        // Infinite chaotic movement
        gsap.to(p, {
            x: `+=${Math.random() * 400 - 200}`,
            y: `+=${Math.random() * 400 - 200}`,
            rotation: `+=${Math.random() * 180 - 90}`,
            duration: Math.random() * 2 + 1,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut"
        });
    }

    // Scene 2: Organized Streams
    const streamsContainer = document.getElementById('organized-streams');
    for (let i = 0; i < 15; i++) {
        const row = document.createElement('div');
        row.className = 'stream-line';
        gsap.set(row, {
            top: `${15 + i * 5}%`,
            opacity: 0.5
        });
        
        const packet = document.createElement('div');
        packet.className = 'stream-packet';
        row.appendChild(packet);
        streamsContainer.appendChild(row);

        // Animate packets flowing
        gsap.fromTo(packet, 
            { x: -100, opacity: 0 },
            { 
                x: window.innerWidth + 100, 
                opacity: 1,
                duration: 2 + Math.random() * 2,
                repeat: -1,
                delay: Math.random() * 2,
                ease: "linear"
            }
        );
    }

    // Scene 3: Scalability Vendors
    const vendorContainer = document.getElementById('vendor-nodes');
    const svgContainer = document.getElementById('connections-svg');
    const vendors = ['OpenAI', 'Anthropic', 'Google', 'Meta', 'Mistral', 'Local LLM'];
    const nodes = [];
    
    // Positions relative to center hub (960, 540)
    const radius = 300;
    vendors.forEach((name, i) => {
        const angle = (i / vendors.length) * Math.PI * 2;
        const x = 960 + Math.cos(angle) * radius;
        const y = 540 + Math.sin(angle) * radius;
        
        const node = document.createElement('div');
        node.className = 'vendor-node';
        node.innerText = name;
        gsap.set(node, { x: x - 50, y: y - 50 }); // offset by half width/height
        vendorContainer.appendChild(node);
        nodes.push(node);

        // Draw connection lines in SVG
        const path = document.createElementNS("http://www.w3.org/2000/svg", "line");
        path.setAttribute('x1', '960');
        path.setAttribute('y1', '540');
        path.setAttribute('x2', x.toString());
        path.setAttribute('y2', y.toString());
        path.setAttribute('class', 'connection-path');
        svgContainer.appendChild(path);
    });

    // --- Master Timeline ---
    const tl = gsap.timeline({ paused: true });
    
    // Subtitles array (Timing is relative to absolute seconds 0-60)
    const subtitlesText = [
        { time: 0, text: "AI is accelerating the modern enterprise," },
        { time: 3, text: "but managing a fleet of independent AI workers across different vendors is <span class='danger'>chaotic</span>." },
        { time: 8, text: "Costs are unpredictable, and oversight is nearly impossible." },
        { time: 12, text: "Enter <span class='highlight'>MeridianOS</span>:" },
        { time: 14, text: "the ultimate control plane for your autonomous AI workforce." },
        { time: 19, text: "It's an orchestration engine that acts as a smart, automated manager..." },
        { time: 23, text: "...bringing order to the chaos." },
        { time: 25, text: "Built for the future, MeridianOS is completely <span class='highlight'>vendor-neutral</span>." },
        { time: 30, text: "Whether you use top-tier models or local solutions," },
        { time: 34, text: "it scales seamlessly without locking you into a single provider." },
        { time: 38, text: "Our core innovation?" },
        { time: 40, text: "<span class='highlight'>Absolute cost governance and safety.</span>" },
        { time: 44, text: "MeridianOS meters every action and enforces strict budgets." },
        { time: 47, text: "Built-in guardrails ensure your AI works securely and efficiently." },
        { time: 50, text: "Highly adaptable and ready to plug into your existing business rules." },
        { time: 54, text: "MeridianOS gives you the limitless power of AI..." },
        { time: 57, text: "...with the control, safety, and predictability you demand." },
        { time: 61, text: "" } // End
    ];

    const subtitleEl = document.getElementById('subtitles');
    
    // Function to add subtitle updates to timeline
    subtitlesText.forEach(sub => {
        tl.call(() => {
            if(sub.text === "") {
                gsap.to(subtitleEl, { opacity: 0, duration: 0.5 });
            } else {
                gsap.to(subtitleEl, { opacity: 0, duration: 0.2, onComplete: () => {
                    subtitleEl.innerHTML = sub.text;
                    gsap.to(subtitleEl, { opacity: 1, duration: 0.3 });
                }});
            }
        }, null, sub.time);
    });

    // --- Scene Animations (Absolute Time Placements) ---

    // Initial State
    tl.set('#scene-1', { autoAlpha: 1 });
    tl.set('#scene-2', { autoAlpha: 0 });
    tl.set('#scene-3', { autoAlpha: 0 });
    tl.set('#scene-4', { autoAlpha: 0 });
    tl.set('#scene-5', { autoAlpha: 0 });
    tl.set('#subtitles', { opacity: 0 });

    // Scene 1: Chaos & Cost Counter (0:00 - 0:12)
    const counterObj = { val: 0 };
    tl.to(counterObj, {
        val: 145892.45, // Spiraling costs
        duration: 11,
        ease: "power2.in",
        onUpdate: () => {
            document.getElementById('cost-counter').innerText = 
                '$' + counterObj.val.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            
            // Make it increasingly red and shaky
            const progress = counterObj.val / 145892.45;
            gsap.set('#cost-counter', { 
                scale: 1 + progress * 0.2,
                x: (Math.random() - 0.5) * progress * 10,
                y: (Math.random() - 0.5) * progress * 10
            });
        }
    }, 0);

    // Scene 2: The System drops in (0:12)
    tl.set('#scene-2', { autoAlpha: 1 }, 12);
    
    // Hub drops in
    tl.to('#meridian-hub', {
        scale: 1,
        duration: 1,
        ease: "back.out(1.7)"
    }, 12);

    // Shockwave clears chaos
    tl.to('#shockwave', {
        opacity: 1,
        scale: 200,
        borderWidth: 0,
        duration: 1.5,
        ease: "power2.out"
    }, 12.2);

    tl.to('#scene-1', { autoAlpha: 0, duration: 0.5 }, 12.5);

    // Scene 3: Flexibility & Scalability (0:25)
    tl.set('#scene-3', { autoAlpha: 1 }, 25);
    
    // Hub Expands slightly
    tl.to('#meridian-hub', {
        scale: 1.5,
        duration: 2,
        ease: "power2.inOut"
    }, 25);

    // Vendor nodes pop in radially
    tl.to('.vendor-node', {
        opacity: 1,
        scale: 1,
        stagger: 0.2,
        duration: 0.5,
        ease: "back.out(2)"
    }, 26);

    // Make streams multiply (by duplicating lines or just speeding them up visually)
    tl.to('.stream-packet', {
        height: 2,
        width: 100,
        boxShadow: "0 0 5px #00f0ff",
        duration: 1
    }, 26);

    // Scene 4: Cost Governance (0:38)
    // Zoom into Hub, reveal dashboard
    tl.to('#meridian-hub', {
        scale: 10,
        opacity: 0,
        duration: 1.5,
        ease: "power3.in"
    }, 38);
    
    tl.to(['#scene-2', '#scene-3'], { autoAlpha: 0, duration: 0.5 }, 39);
    
    tl.set('#scene-4', { autoAlpha: 1 }, 39);
    tl.to('#dashboard', {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 1,
        ease: "power2.out"
    }, 39.5);
    gsap.set('#dashboard', { y: 50, scale: 0.9 }); // setup for from

    // Animate budget meters filling up
    tl.to('#meter-1', { width: '45%', duration: 4, ease: "linear" }, 40);
    tl.to('#meter-2', { width: '60%', duration: 5, ease: "linear" }, 40);
    
    // Model C meter goes orange and gets blocked
    tl.to('#meter-3', { width: '95%', duration: 6, ease: "power1.in" }, 40);
    tl.to('#meter-3', { background: 'linear-gradient(90deg, #ff3300, #ff0000)', duration: 0.5 }, 44); // Turns red around 44s
    tl.to('#gate-block', {
        opacity: 1,
        x: 0,
        duration: 0.5,
        ease: "back.out(3)"
    }, 45.5);
    tl.to('#meter-3', { width: '95%', duration: 2 }, 46); // Stays at 95% due to block

    // Scene 5: Shield & Conclusion (0:50)
    tl.to('#dashboard', {
        scale: 0.5,
        opacity: 0,
        duration: 1.5,
        ease: "power2.in"
    }, 50);

    tl.set('#scene-5', { autoAlpha: 1 }, 51);
    
    // Shield morphs in (simulate by scaling icon)
    tl.to('#shield-icon', {
        scale: 1,
        duration: 1.5,
        ease: "elastic.out(1, 0.5)"
    }, 51.5);

    // Background fades to city
    tl.to('#city-bg', {
        opacity: 1,
        duration: 2
    }, 52);

    // Fade to Logo
    tl.to('#shield-icon', {
        opacity: 0,
        scale: 2,
        duration: 1,
        ease: "power2.in"
    }, 56);
    
    tl.to('#final-logo', {
        opacity: 1,
        scale: 1,
        duration: 1.5,
        ease: "power2.out"
    }, 57);
    gsap.set('#final-logo', { scale: 0.8 });

    // --- Play Mechanism ---
    const playBtn = document.getElementById('play-btn');
    playBtn.addEventListener('click', () => {
        playBtn.style.display = 'none';
        tl.play();
    });
});
