/**
 * Curiosity Engine - Particles Background
 *
 * Full-screen animated particle network with mouse interaction.
 * Uses @tsparticles/react for a premium, living-science aesthetic.
 */

import { useEffect, useState } from 'react';
import Particles, { initParticlesEngine } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';

export default function ParticlesBackground() {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        initParticlesEngine(async (engine) => {
            await loadSlim(engine);
        }).then(() => setReady(true));
    }, []);

    if (!ready) return null;

    return (
        <Particles
            id="tsparticles"
            options={{
                fullScreen: { enable: true, zIndex: -1 },
                background: {
                    color: { value: '#0a0a1a' },
                },
                fpsLimit: 60,
                particles: {
                    color: { value: ['#00f5ff', '#a78bfa', '#22d3ee', '#c084fc', '#67e8f9'] },
                    links: {
                        enable: true,
                        color: '#3b82f6',
                        distance: 80,
                        opacity: 0.55,
                        width: 0.6,
                    },
                    move: {
                        enable: true,
                        speed: 0.5,
                        direction: 'none' as const,
                        random: true,
                        straight: false,
                        outModes: { default: 'bounce' as const },
                    },
                    number: {
                        value: 350,
                        density: { enable: true },
                    },
                    opacity: {
                        value: { min: 0.4, max: 0.85 },
                    },
                    size: {
                        value: { min: 0.8, max: 2 },
                    },
                    shape: {
                        type: 'circle',
                    },
                },
                interactivity: {
                    events: {
                        onHover: {
                            enable: true,
                            mode: 'grab',
                        },
                        onClick: {
                            enable: true,
                            mode: 'push',
                        },
                    },
                    modes: {
                        grab: {
                            distance: 110,
                            links: { opacity: 0.85 },
                        },
                        push: {
                            quantity: 4,
                        },
                    },
                },
                detectRetina: true,
            }}
        />
    );
}
