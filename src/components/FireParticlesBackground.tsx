import React, { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  size: number;
  speedY: number;
  speedX: number;
  opacity: number;
  maxOpacity: number;
  fadeSpeed: number;
  color: string;
  glowColor: string;
  life: number;
  maxLife: number;
  swayFreq: number;
  swayAmp: number;
  spark: boolean;
}

interface FireParticlesBackgroundProps {
  enabled?: boolean;
}

export const FireParticlesBackground: React.FC<FireParticlesBackgroundProps> = ({ enabled = true }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    // Crisp white ember & particle palette
    const emberColors = [
      { core: 'rgba(255, 255, 255, ', glow: 'rgba(255, 255, 255, ' }, // Pure white
      { core: 'rgba(248, 250, 252, ', glow: 'rgba(226, 232, 240, ' }, // Bright silver white
      { core: 'rgba(255, 255, 255, ', glow: 'rgba(203, 213, 225, ' }, // Crisp white
      { core: 'rgba(241, 245, 249, ', glow: 'rgba(255, 255, 255, ' }, // Soft white
    ];

    const particles: Particle[] = [];
    const maxParticles = Math.min(175, Math.floor(width / 7.5));

    const createParticle = (initialRandomY = false): Particle => {
      const colorScheme = emberColors[Math.floor(Math.random() * emberColors.length)];
      const isSpark = Math.random() < 0.4;
      const size = isSpark ? Math.random() * 1.8 + 1.0 : Math.random() * 3.2 + 1.8;
      const maxOpacity = isSpark ? Math.random() * 0.6 + 0.3 : Math.random() * 0.35 + 0.2;
      const maxLife = isSpark ? Math.random() * 140 + 90 : Math.random() * 260 + 160;

      return {
        x: Math.random() * width,
        y: initialRandomY ? Math.random() * height : height + Math.random() * 40,
        size,
        speedY: isSpark ? -(Math.random() * 2.8 + 1.8) : -(Math.random() * 1.6 + 0.8),
        speedX: (Math.random() - 0.5) * 0.5,
        opacity: initialRandomY ? Math.random() * maxOpacity : 0,
        maxOpacity,
        fadeSpeed: 0.005 + Math.random() * 0.004,
        color: colorScheme.core,
        glowColor: colorScheme.glow,
        life: initialRandomY ? Math.random() * maxLife : 0,
        maxLife,
        swayFreq: Math.random() * 0.02 + 0.008,
        swayAmp: Math.random() * 0.9 + 0.3,
        spark: isSpark,
      };
    };

    // Initialize initial pool of particles spread throughout viewport
    for (let i = 0; i < maxParticles; i++) {
      particles.push(createParticle(true));
    }

    // Interactive mouse wind / spark draft
    let mouseX = width / 2;
    let mouseY = height / 2;
    let isMouseActive = false;
    let mouseTimeout: any;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      isMouseActive = true;
      clearTimeout(mouseTimeout);
      mouseTimeout = setTimeout(() => {
        isMouseActive = false;
      }, 1500);
    };

    window.addEventListener('mousemove', handleMouseMove);

    let lastTime = performance.now();

    const render = (time: number) => {
      // Skip rendering if tab is hidden in background
      if (document.visibilityState === 'hidden') {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      // Adapt smoothly to high refresh rate (120Hz+) screens using time delta
      const dt = Math.min((time - lastTime) / 1000 * 60, 3.0);
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      // Subtle bottom glow gradient
      const bottomGlow = ctx.createLinearGradient(0, height, 0, height - 160);
      bottomGlow.addColorStop(0, 'rgba(255, 255, 255, 0.025)');
      bottomGlow.addColorStop(0.5, 'rgba(255, 255, 255, 0.008)');
      bottomGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bottomGlow;
      ctx.fillRect(0, height - 160, width, 160);

      // Render & update particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        p.life += dt;
        p.y += p.speedY * dt;
        p.x += (p.speedX + Math.sin(p.life * p.swayFreq) * p.swayAmp) * dt;

        // Mouse draft interaction
        if (isMouseActive) {
          const dx = p.x - mouseX;
          const dy = p.y - mouseY;
          const distSq = dx * dx + dy * dy;
          if (distSq < 22000 && distSq > 80) {
            const force = (1 - Math.sqrt(distSq) / 150) * 0.35;
            p.x += (dx > 0 ? 1 : -1) * force * 1.5 * dt;
            p.y -= force * 1.2 * dt;
          }
        }

        // Fade in and fade out curve
        const progress = p.life / p.maxLife;
        if (progress < 0.2) {
          p.opacity = Math.min(p.maxOpacity, p.opacity + p.fadeSpeed * dt * 3);
        } else if (progress > 0.75) {
          p.opacity = Math.max(0, p.opacity - p.fadeSpeed * dt * 2.5);
        }

        // Flicker effect
        const flicker = 1 + (Math.sin(p.life * 0.35) * 0.12);
        const currentAlpha = Math.min(1, Math.max(0, p.opacity * flicker));

        if (currentAlpha > 0.01) {
          // Crisp Square Particle (no glow)
          ctx.fillStyle = `rgba(255, 255, 255, ${currentAlpha})`;
          const s = p.size * 2;
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        }

        // Reset if out of bounds or dead
        if (p.y < -60 || p.x < -40 || p.x > width + 40 || p.life >= p.maxLife || p.opacity <= 0.005) {
          particles[i] = createParticle(false);
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(mouseTimeout);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 opacity-80"
      style={{
        mixBlendMode: 'screen',
      }}
    />
  );
};
