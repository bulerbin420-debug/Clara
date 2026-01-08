import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Power, Settings, X, Upload, Image as ImageIcon } from 'lucide-react';

import Avatar from './components/Avatar';
import Visualizer from './components/Visualizer';
import Chat from './components/Chat';
import { AvatarPose, ChatMessage } from './types';
import { base64ToUint8Array, createPcmBlob, decodeAudioData } from './utils/audioUtils';

// FIX: Safely access API_KEY to prevent "process is not defined" errors in browser environments
const API_KEY = (typeof process !== 'undefined' && process.env && process.env.API_KEY) || '';

export default function App() {
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [avatarPose, setAvatarPose] = useState<AvatarPose>(AvatarPose.IDLE_FRONT);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Custom Avatar Config
  const [showSettings, setShowSettings] = useState(false);
  const [customImage, setCustomImage] = useState<string | null>(null);
  
  // Changed Default: false (Simulated Mode) to support standard photos (like Clara.jpg) by default
  const [isSpriteMode, setIsSpriteMode] = useState(false);

  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  
  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  
  // Audio Queue
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  // Gemini Session (Live)
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  
  // Refs for cleanup
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const idleTimeoutRef = useRef<any>(null);

  // Transcriptions buffers for Live API
  const currentInputTransRef = useRef('');
  const currentOutputTransRef = useRef('');


  // --- Image Processing (Auto-crop + resize to match avatar window) ---
  const AVATAR_ASPECT = 320 / 384; // matches <Avatar /> container (w-80 h-96)
  const OUTPUT_W = 640; // 2x for crisp rendering
  const OUTPUT_H = 768;

  const cropAndResizeDataUrl = async (dataUrl: string) => {
    // Crop to the avatar aspect ratio and resize so it perfectly fits the visible window.
    // Returns a JPEG data URL.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = dataUrl;
    });

    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const srcAspect = iw / ih;

    let sx = 0, sy = 0, sw = iw, sh = ih;

    if (srcAspect > AVATAR_ASPECT) {
      // Too wide → crop left/right
      sw = Math.round(ih * AVATAR_ASPECT);
      sx = Math.round((iw - sw) / 2);
    } else if (srcAspect < AVATAR_ASPECT) {
      // Too tall → crop top/bottom (slight upward bias to keep faces)
      sh = Math.round(iw / AVATAR_ASPECT);
      const maxShift = ih - sh;
      const bias = 0.18; // 0 = top, 0.5 = center, 1 = bottom
      sy = Math.round(maxShift * bias);
    }

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_W;
    canvas.height = OUTPUT_H;

    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT_W, OUTPUT_H);

    // Slight sharpening-ish trick: draw a tiny scaled overlay (optional, safe)
    // (kept minimal to avoid artifacts)
    return canvas.toDataURL('image/jpeg', 0.92);
  };

  // --- File Upload Handler ---
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setCustomImage(result);
        // Default to FALSE (Simulated/Auto-Crop Mode) for user uploads
        // This ensures regular photos look good immediately.
        setIsSpriteMode(false); 
        setShowSettings(false);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Audio Infrastructure ---

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass({ sampleRate: 24000 }); // Output sample rate
      
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 64;
      
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(analyserRef.current);
      analyserRef.current.connect(audioContextRef.current.destination);
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const playAudioChunk = async (base64Audio: string) => {
    const ctx = ensureAudioContext();
    if (!gainNodeRef.current) return;

    try {
        const audioBuffer = await decodeAudioData(
            base64ToUint8Array(base64Audio),
            ctx,
            24000,
            1
        );

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNodeRef.current);

        // Schedule playback
        const currentTime = ctx.currentTime;
        if (nextStartTimeRef.current < currentTime) {
            nextStartTimeRef.current = currentTime;
        }
        
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
        
        audioSourcesRef.current.add(source);
        
        // Avatar Talking State
        setAvatarPose(AvatarPose.IDLE_FRONT);
        resetIdleTimer();

        source.onended = () => {
            audioSourcesRef.current.delete(source);
            if (audioSourcesRef.current.size === 0) {
                // Determine pose based on connection state
            }
        };
    } catch (e) {
        console.error("Audio decode error", e);
    }
  };

  const stopAllAudio = () => {
    audioSourcesRef.current.forEach(s => {
        try { s.stop(); } catch(e) {}
    });
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  };

  // --- Modes ---

  // 1. Text Mode (2-Step: Think -> Speak)
  const sendTextMessage = async (text: string) => {
    if (!API_KEY) {
        setError("API Key missing");
        return;
    }
    
    if (isLiveConnected) {
        await disconnectLive();
    }

    addMessage('user', text, true);
    setIsLoading(true);
    setAvatarPose(AvatarPose.THINKING_GHOST);

    try {
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        
        // Step 1: Generate Text Response
        // Note: The SDK returns the response object directly, so we access .text immediately.
        const textResponseResult = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [{ text }] },
            config: {
                systemInstruction: "You are a helpful, empathetic, and lively female AI assistant. Keep responses concise.",
            },
        });

        // FIX: Access .text directly from the response object
        const responseText = textResponseResult.text || "I'm not sure what to say.";
        addMessage('model', responseText, true);

        // Step 2: Generate Audio for the response (TTS)
        // TTS model does NOT support systemInstruction, so we don't pass it.
        const ttsResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview-tts',
            contents: { parts: [{ text: responseText }] },
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                },
            },
        });

        const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            await playAudioChunk(base64Audio);
        }

    } catch (e: any) {
        console.error(e);
        setError(e.message || "Error generating response");
    } finally {
        setIsLoading(false);
        setAvatarPose(AvatarPose.IDLE_FRONT);
    }
  };

  // 2. Live Mode (WebSockets)
  const connectLive = async () => {
    if (!API_KEY) return;
    
    setIsLoading(true);
    setAvatarPose(AvatarPose.THINKING_GHOST);
    setError(null);

    try {
      const ctx = ensureAudioContext();
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const inputSource = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;
      
      inputSource.connect(processor);
      processor.connect(ctx.destination);

      const ai = new GoogleGenAI({ apiKey: API_KEY });

      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          inputAudioTranscription: {}, 
          outputAudioTranscription: {},
          systemInstruction: `You are a helpful, empathetic, and lively female AI assistant.`,
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Connected');
            setIsLiveConnected(true);
            setIsMicOn(true);
            setIsLoading(false);
            setAvatarPose(AvatarPose.IDLE_FRONT);

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createPcmBlob(inputData);
                
                sessionPromiseRef.current?.then(session => {
                    session.sendRealtimeInput({ media: pcmBlob });
                });

                // Simple VAD
                let sum = 0;
                for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
                const rms = Math.sqrt(sum / inputData.length);
                if (rms > 0.02) { 
                    setAvatarPose(AvatarPose.LISTENING_SIDE);
                    resetIdleTimer();
                }
            };
          },
          onmessage: (msg: LiveServerMessage) => {
            const base64Audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
                playAudioChunk(base64Audio);
            }

            const outputTrans = msg.serverContent?.outputTranscription?.text;
            if (outputTrans) {
                currentOutputTransRef.current += outputTrans;
                updateLiveMessage('model', currentOutputTransRef.current);
            }

            const inputTrans = msg.serverContent?.inputTranscription?.text;
            if (inputTrans) {
                currentInputTransRef.current += inputTrans;
                updateLiveMessage('user', currentInputTransRef.current);
            }

            if (msg.serverContent?.turnComplete) {
                if (currentOutputTransRef.current) {
                    finalizeMessage('model', currentOutputTransRef.current);
                    currentOutputTransRef.current = '';
                }
                if (currentInputTransRef.current) {
                    finalizeMessage('user', currentInputTransRef.current);
                    currentInputTransRef.current = '';
                }
            }

            if (msg.serverContent?.interrupted) {
                stopAllAudio();
                currentOutputTransRef.current = '';
                setAvatarPose(AvatarPose.LISTENING_SIDE);
            }
          },
          onclose: () => {
            console.log('Live Closed');
            setIsLiveConnected(false);
            setIsMicOn(false);
            setAvatarPose(AvatarPose.IDLE_FRONT);
          },
          onerror: (err) => {
            console.error('Live Error', err);
            disconnectLive();
            setError("Live session disconnected.");
          }
        }
      });

    } catch (e: any) {
        console.error(e);
        setError("Could not access microphone or connect.");
        setIsLoading(false);
        setAvatarPose(AvatarPose.IDLE_FRONT);
    }
  };

  const disconnectLive = async () => {
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
    }
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }
    
    stopAllAudio();
    setIsLiveConnected(false);
    setIsMicOn(false);
    setAvatarPose(AvatarPose.IDLE_FRONT);
  };

  const resetIdleTimer = useCallback(() => {
    if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    idleTimeoutRef.current = setTimeout(() => {
       setAvatarPose(AvatarPose.IDLE_FRONT);
    }, 2000);
  }, []);

  const addMessage = (role: 'user' | 'model', text: string, isFinal: boolean = true) => {
    setMessages(prev => [...prev, { id: Date.now().toString() + Math.random(), role, text, isFinal }]);
  };

  const updateLiveMessage = (role: 'user' | 'model', text: string) => {
    setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === role && !lastMsg.isFinal) {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1] = { ...lastMsg, text };
            return newMessages;
        } else {
            return [...prev, { id: Date.now().toString(), role, text, isFinal: false }];
        }
    });
  };

  const finalizeMessage = (role: 'user' | 'model', text: string) => {
    setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.role === role && !lastMsg.isFinal) {
            const newMessages = [...prev];
            newMessages[newMessages.length - 1] = { ...lastMsg, text, isFinal: true };
            return newMessages;
        }
        return prev;
    });
  };

  const handleMicToggle = () => {
    if (isMicOn) {
        disconnectLive();
    } else {
        connectLive();
    }
  };

  const handleSendText = (text: string) => {
      setInput('');
      sendTextMessage(text);
  };

  useEffect(() => {
    return () => {
        disconnectLive();
        if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  return (
    <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center p-4 relative overflow-hidden font-sans text-stone-100">
      
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className={`absolute inset-0 bg-gradient-to-br from-stone-800 to-stone-950 transition-opacity duration-1000 ${isLiveConnected ? 'opacity-100' : 'opacity-0'}`} />
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-orange-500/5 rounded-full blur-[150px]" />
      </div>

      <div className="z-10 w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8 min-h-[600px] items-center relative">
        
        {/* Settings / Upload Controls */}
        <div className="absolute top-0 right-0 z-50">
           <button 
             onClick={() => setShowSettings(!showSettings)}
             className="p-2 text-white/30 hover:text-white hover:bg-white/10 rounded-full transition-colors"
           >
             <Settings size={20} />
           </button>
        </div>

        {/* Configuration Modal */}
        {showSettings && (
            <div className="absolute top-10 right-0 w-72 bg-stone-800/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl p-4 z-50 animate-fade-in">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-semibold text-white">Character Setup</h3>
                    <button onClick={() => setShowSettings(false)} className="text-white/50 hover:text-white">
                        <X size={16} />
                    </button>
                </div>
                
                <div className="space-y-4">
                    <div className="border border-dashed border-white/20 rounded-lg p-4 text-center hover:bg-white/5 transition-colors cursor-pointer relative">
                        <input 
                            type="file" 
                            accept="image/*"
                            onChange={handleFileUpload}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                        <div className="flex flex-col items-center gap-2 text-white/60">
                            <Upload size={24} />
                            <span className="text-xs">Upload Screenshot</span>
                        </div>
                    </div>
                    <p className="text-[10px] text-white/30 text-center">
                        Upload the screenshot you provided to instantly clone the character.
                    </p>
                </div>
            </div>
        )}

        {/* Left Column: Avatar & Controls */}
        <div className="flex flex-col items-center gap-6">
            {/* Status */}
            <div className={`flex items-center gap-2 px-4 py-2 backdrop-blur-md rounded-full border border-white/10 transition-colors shadow-lg ${isLiveConnected ? 'bg-indigo-500/10 border-indigo-500/20' : 'bg-white/5'}`}>
              <div className={`w-2 h-2 rounded-full ${isLiveConnected ? 'bg-green-500 animate-pulse' : 'bg-stone-500'}`} />
              <span className="text-xs font-medium text-white/60 tracking-wider">
                {isLiveConnected ? 'LIVE VOICE' : 'TEXT MODE'}
              </span>
            </div>

            {/* Avatar Container */}
            <div className="relative group">
                <Avatar pose={avatarPose} imageUrl={customImage || undefined} isSpriteMode={!!customImage || isSpriteMode} />
                
                {/* Visualizer Overlay */}
                <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-stone-900 to-transparent flex items-end justify-center pb-4 pointer-events-none">
                     <Visualizer isActive={true} analyser={analyserRef.current} />
                </div>
                
                {/* Minimal Upload Button (Only shows on Hover now) */}
                <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                    <button 
                        onClick={() => setShowSettings(true)}
                        className="bg-black/50 hover:bg-black/70 text-white p-2 rounded-full backdrop-blur-sm"
                        title="Change Avatar"
                    >
                        <ImageIcon size={14} />
                    </button>
                </div>
            </div>

            {/* Control Button (Mic) */}
            <button
                onClick={handleMicToggle}
                disabled={isLoading}
                className={`flex items-center gap-3 px-8 py-3.5 rounded-full font-medium transition-all shadow-xl hover:scale-105 ${
                    isLiveConnected 
                    ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20' 
                    : 'bg-white/10 text-white hover:bg-white/20 border border-white/5'
                }`}
            >
                <Power size={18} />
                <span>{isLiveConnected ? 'End Session' : 'Start Conversation'}</span>
            </button>
        </div>

        {/* Right Column: Chat Interface */}
        <div className="w-full h-full max-h-[600px] flex flex-col justify-center">
             <Chat 
                messages={messages} 
                onSend={handleSendText} 
                input={input} 
                setInput={setInput} 
                isMicOn={isMicOn}
                onToggleMic={handleMicToggle}
                isConnected={true} 
             />
             {error && (
                <div className="mt-4 bg-red-500/10 border border-red-500/20 text-red-200 text-xs px-3 py-2 rounded-lg text-center animate-fade-in">
                    {error}
                </div>
            )}
        </div>

      </div>
    </div>
  );
}