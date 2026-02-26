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
    id: string;
  };
  content: string;
  timestamp: Date;
}

interface DiscordAuthor {
  id: string;
  username: string;
  avatar: string | null;
  bot?: boolean;
  discriminator: string;
}

interface DiscordMessage {
  id: string;
  content: string;
  author: DiscordAuthor;
  timestamp: string;
}

export const StudioChatPanel = () => {
  const { user } = useUserStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [memberCount, setMemberCount] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchMessages = async () => {
    try {
      const response = await fetch('/.netlify/functions/studio-chat');
      if (!response.ok) throw new Error('Failed to fetch messages');
      
      const data = await response.json();
      
      if (data.memberCount) {
        setMemberCount(data.memberCount);
      }

      const mappedMessages: Message[] = data.messages.map((msg: DiscordMessage) => {
        // Construct avatar URL
        let avatarUrl = undefined;
        if (msg.author.avatar) {
          avatarUrl = `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png`;
        } else {
          // Default avatar based on discriminator
          const discriminator = parseInt(msg.author.discriminator) % 5;
          avatarUrl = `https://cdn.discordapp.com/embed/avatars/${discriminator}.png`;
        }

        // Handle Bot Proxy Messages (format: "**Username**: Message")
        let displayUsername = msg.author.username;
        let displayContent = msg.content;
        let isBot = msg.author.bot;

        // Simple check if it looks like a proxied message from our bot
        // This is a heuristic; in a real app we might use a specific bot ID check or metadata
        if (msg.author.bot && msg.content.startsWith('**') && msg.content.includes('**: ')) {
          const match = msg.content.match(/^\*\*(.*?)\*\*: (.*)$/s);
          if (match) {
            displayUsername = match[1];
            displayContent = match[2];
            isBot = false; // Treat as user message visually
          }
        }

        return {
          id: msg.id,
          author: {
            id: msg.author.id,
            username: displayUsername,
            avatarUrl,
            isBot
          },
          content: displayContent,
          timestamp: new Date(msg.timestamp)
        };
      }).reverse(); // Discord returns newest first, we want oldest first for chat log

      setMessages(mappedMessages);
    } catch (error) {
      console.error('Error fetching chat:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for new messages every 5 seconds
  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const contentToSend = inputValue;
    setInputValue(''); // Clear input immediately

    // Optimistic update
    const tempId = Date.now().toString();
    const optimisticMessage: Message = {
      id: tempId,
      author: {
        id: user?.id || 'guest',
        username: user?.username || 'Guest',
        avatarUrl: user?.avatarUrl || undefined,
        isBot: false,
      },
      content: contentToSend,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, optimisticMessage]);

    try {
      await fetch('/.netlify/functions/studio-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: contentToSend,
          username: user?.username || 'Guest',
          avatar_url: user?.avatarUrl
        }),
      });
      
      // Fetch specifically to get the real message and replace/update
      // fetchMessages(); // Let the poller handle it or do it here
      setTimeout(fetchMessages, 500); // Small delay to ensure Discord processed it
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic message on failure? Or show error state.
      // For now, simple console error.
    }
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
          <span>{memberCount > 0 ? memberCount.toLocaleString() : '...'}</span>
        </div>
      </div>
      
      <div className="chat-messages">
        {isLoading && messages.length === 0 ? (
          <div className="chat-loading">Loading messages...</div>
        ) : (
          messages.map((msg) => (
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
          ))
        )}
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
