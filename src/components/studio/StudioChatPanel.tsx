import { useState, useEffect, useRef } from 'react';
import { PaperPlaneRight, Hash, Users, Smiley } from '@phosphor-icons/react';
import { useUserStore } from '../../state/useUserStore';
import './StudioChatPanel.css';

interface Message {
  id: string;
  author: {
    username: string;
    avatarUrl?: string;
    isBot?: boolean;
  };
  content: string;
  timestamp: Date;
}

export const StudioChatPanel = () => {
  const { user } = useUserStore();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      author: { username: 'System', isBot: true },
      content: 'Welcome to the Studio Feed! Chat with other creators here.',
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      author: {
        username: user?.username || 'Guest',
        avatarUrl: user?.avatarUrl || undefined,
      },
      content: inputValue,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);
    setInputValue('');
    
    // TODO: Send to backend/Discord via bot or webhook
  };

  return (
    <aside className="studio-chat-panel">
      <div className="chat-header">
        <div className="channel-info">
          <Hash size={20} weight="bold" />
          <span>studio-chat</span>
        </div>
        <div className="online-count">
          <Users size={16} />
          <span>24</span>
        </div>
      </div>
      
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.author.username === user?.username ? 'own' : ''}`}>
            <div className="message-avatar">
              {msg.author.avatarUrl ? (
                <img src={msg.author.avatarUrl} alt={msg.author.username} />
              ) : (
                <div className="avatar-placeholder">{msg.author.username[0]}</div>
              )}
            </div>
            <div className="message-content">
              <div className="message-header">
                <span className="username">{msg.author.username}</span>
                <span className="timestamp">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p>{msg.content}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <div className="input-wrapper">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Message #studio-chat..."
          />
          <button className="emoji-btn">
            <Smiley size={20} />
          </button>
        </div>
        <button className="send-btn" onClick={handleSendMessage} disabled={!inputValue.trim()}>
          <PaperPlaneRight size={20} weight="fill" />
        </button>
      </div>
    </aside>
  );
};
