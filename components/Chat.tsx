import React, { useRef, useEffect } from 'react';
import { Send, Mic, MicOff } from 'lucide-react';
import { ChatMessage } from '../types';

interface ChatProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  input: string;
  setInput: (text: string) => void;
  isMicOn: boolean;
  onToggleMic: () => void;
  isConnected: boolean;
}

const Chat: React.FC<ChatProps> = ({ 
  messages, 
  onSend, 
  input, 
  setInput, 
  isMicOn, 
  onToggleMic,
  isConnected 
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSend(input);
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[400px] w-full max-w-md backdrop-blur-sm bg-black/20 rounded-2xl border border-white/10 overflow-hidden shadow-xl">
      {/* Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
      >
        {messages.length === 0 && (
          <div className="text-center text-white/30 text-sm mt-10">
            Start a conversation by typing or speaking...
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-none'
                  : 'bg-white/10 text-white/90 rounded-bl-none'
              } ${!msg.isFinal ? 'opacity-70 animate-pulse' : ''}`}
            >
              {msg.text}
            </div>
          </div>
        ))}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-3 bg-black/40 border-t border-white/5 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleMic}
          disabled={!isConnected}
          className={`p-2.5 rounded-full transition-colors ${
            !isConnected ? 'opacity-30 cursor-not-allowed bg-gray-700' :
            isMicOn ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-white/5 text-white/60 hover:bg-white/10'
          }`}
          title={isMicOn ? "Mute Microphone" : "Unmute Microphone"}
        >
          {isMicOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>

        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isConnected ? "Type a message..." : "Type to start chat..."}
          className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all placeholder:text-white/20"
        />

        <button
          type="submit"
          disabled={!input.trim()}
          className={`p-2.5 rounded-full transition-all ${
            input.trim() 
              ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20' 
              : 'bg-white/5 text-white/20 cursor-not-allowed'
          }`}
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
};

export default Chat;
