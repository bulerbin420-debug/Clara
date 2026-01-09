import React, { useMemo, useState, useEffect } from 'react';
import { AvatarPose } from '../types';

// Strategies for loading the avatar:
// 1. Try the local file at root ('/Clara.jpg')
// 2. Fallback to a reliable external URL if local fails
const LOCAL_AVATAR = `${import.meta.env.BASE_URL}Clara.jpg`;
const FALLBACK_AVATAR = 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=800&auto=format&fit=crop';

interface AvatarProps {
  pose: AvatarPose;
  imageUrl?: string;
  isSpriteMode?: boolean;
}

const Avatar: React.FC<AvatarProps> = ({ pose, imageUrl, isSpriteMode = false }) => {
  // Manage source state to handle loading failures gracefully
  const [currentSrc, setCurrentSrc] = useState<string>(imageUrl || LOCAL_AVATAR);

  // Update source if prop changes, or try to load local file
  useEffect(() => {
    if (imageUrl) {
      setCurrentSrc(imageUrl);
      return;
    }

    // Try to load the local image
    const img = new Image();
    img.src = LOCAL_AVATAR;
    img.onload = () => setCurrentSrc(LOCAL_AVATAR);
    img.onerror = () => {
      console.warn('Failed to load local avatar, falling back to external image.');
      setCurrentSrc(FALLBACK_AVATAR);
    };
  }, [imageUrl]);

  const styles = useMemo(() => {
    if (isSpriteMode) {
      // --- SPRITE SHEET LOGIC (For pre-sliced character sheets) ---
      const common = {
        backgroundImage: `url(${currentSrc})`,
        backgroundRepeat: 'no-repeat',
        transition: 'filter 0.3s ease',
      };

      switch (pose) {
        case AvatarPose.LISTENING_SIDE:
          return {
            ...common,
            backgroundPosition: '0% 100%',
            backgroundSize: '300% 200%', 
          };
        case AvatarPose.WALKING_AWAY:
          return {
            ...common,
            backgroundPosition: '100% 100%',
            backgroundSize: '300% 200%',
          };
        case AvatarPose.THINKING_GHOST:
          return {
            ...common,
            backgroundPosition: '50% 0%',
            backgroundSize: '100% 200%',
            filter: 'opacity(0.9) sepia(0.1)',
          };
        case AvatarPose.IDLE_FRONT:
        default:
          return {
            ...common,
            backgroundPosition: '50% 100%',
            backgroundSize: '300% 200%',
          };
      }
    } else {
      // --- SIMULATED MODE (Auto-Crop & Animate Single Images) ---
      const common = {
        backgroundImage: `url(${currentSrc})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: 'cover', 
        // Adjusted to 'center 20%' which is generally safe for portrait photos to show the face
        backgroundPosition: 'center 20%', 
        transition: 'transform 0.8s cubic-bezier(0.2, 0.8, 0.2, 1), filter 0.4s ease',
      };

      switch (pose) {
        case AvatarPose.LISTENING_SIDE:
          return { ...common, transform: 'scale(1.05) translateX(-2%) rotateY(-5deg)' };
        case AvatarPose.THINKING_GHOST:
          return { ...common, filter: 'brightness(1.1) contrast(0.9)', transform: 'scale(1.02)' };
        case AvatarPose.WALKING_AWAY:
          return { ...common, transform: 'scale(1.0) rotateY(3deg) opacity(0.95)' };
        case AvatarPose.IDLE_FRONT:
        default:
          return { ...common, transform: 'scale(1.02)' };
      }
    }
  }, [pose, currentSrc, isSpriteMode]);

  return (
    <div className="relative w-80 h-96 overflow-hidden rounded-2xl shadow-2xl border border-white/10 bg-stone-900 ring-1 ring-white/5">
      {/* Warm Ambient Lighting */}
      <div className="absolute inset-0 bg-gradient-to-t from-stone-900/80 via-transparent to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-tr from-orange-500/10 to-transparent z-10 pointer-events-none mix-blend-overlay" />
      
      {/* Avatar Layer */}
      <div 
        className="absolute inset-0 w-full h-full animate-breathe will-change-transform origin-bottom"
        style={styles}
      />

      {/* Overlay Status Indicator */}
      <div className="absolute top-4 right-4 z-20">
         <div className={`w-2.5 h-2.5 rounded-full ${
             pose === AvatarPose.THINKING_GHOST ? 'bg-indigo-400 animate-pulse' :
             pose === AvatarPose.LISTENING_SIDE ? 'bg-emerald-400' :
             'bg-stone-400'
         } shadow-[0_0_12px_rgba(255,255,255,0.3)] transition-colors duration-500`} />
      </div>
    </div>
  );
};

export default Avatar;