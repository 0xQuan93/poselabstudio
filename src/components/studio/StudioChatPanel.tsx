import { useState, useEffect, useRef } from 'react';
import { PaperPlaneRight, Hash, Users, Smiley } from '@phosphor-icons/react';
import { useUserStore } from '../../state/useUserStore';
import { liveKitManager } from '../../multiplayer/livekitManager';
import { ActionParser } from '../../ai/utils/ActionParser';
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
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      author: { 
        username: 'System', 
        isBot: true,
        id: 'system', 
        avatarUrl: undefined 
      },
      content: 'Welcome to the Studio Feed! Chat with other creators here.',
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [memberCount, setMemberCount] = useState<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastProcessedMsgTime = useRef<number>(0);
  useEffect(() => { lastProcessedMsgTime.current = Date.now(); }, []);
  const seenLiveKitMessages = useRef<Set<string>>(new Set());

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // LiveKit real-time chat integration
  useEffect(() => {
    const unsubscribe = liveKitManager.onMessage((peerId, message) => {
      if (message.type === 'chat') {
        // Prevent echoing our own broadcast
        const msgKey = `${peerId}-${message.timestamp}`;
        if (seenLiveKitMessages.current.has(msgKey)) return;
        seenLiveKitMessages.current.add(msgKey);

        setMessages(prev => [...prev, {
          id: `lk-${message.timestamp}-${peerId}`,
          author: {
            id: peerId,
            username: message.displayName,
            isBot: false
          },
          content: message.text,
          timestamp: new Date(message.timestamp)
        }]);
      }
    });
    return unsubscribe;
  }, []);

  const fetchMessages = async () => {
    try {
      const response = await fetch('/.netlify/functions/studio-chat');
      if (!response.ok) throw new Error('Failed to fetch messages');
      
      const data = await response.json();
      
      if (data.memberCount) {
        setMemberCount(data.memberCount);
      }

      const mappedMessages: Message[] = data.messages.map((msg: DiscordMessage) => {
        const avatarUrl = msg.author.avatar ? `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${(parseInt(msg.author.discriminator) || 0) % 5}.png`;
        let displayUsername = msg.author.username;
        let displayContent = msg.content;
        let isBot = msg.author.bot;

        if (msg.author.bot && msg.content.startsWith('**') && msg.content.includes('**: ')) {
          const match = msg.content.match(/^\*\*(.*?)\*\*: (.*)$/s);
          if (match) {
            displayUsername = match[1];
            displayContent = match[2];
            isBot = false;
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
      }).reverse();

      setMessages(prevMessages => {
        // Merge Discord messages with LiveKit messages, preferring Discord IDs for stability
        const newMap = new Map<string, Message>();
        prevMessages.forEach(m => newMap.set(m.id, m));
        
        let highestTime = lastProcessedMsgTime.current;

        mappedMessages.forEach(m => {
          // Add or overwrite with Discord authoritative message
          newMap.set(m.id, m);

          // Process AI Commands for NEW messages
          const msgTime = m.timestamp.getTime();
          if (msgTime > lastProcessedMsgTime.current) {
            highestTime = Math.max(highestTime, msgTime);
            if (m.content.includes('<command>')) {
               ActionParser.execute(m.content, () => {}).catch(e => console.error("ActionParser error:", e));
            }
          }
        });

        lastProcessedMsgTime.current = highestTime;
        
        return Array.from(newMap.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      });

    } catch (error) {
      console.error('Error fetching chat:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll for new messages every 10 seconds (reduced from 5s for efficiency, since LK handles instant chat)
  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;

    const contentToSend = inputValue;
    setInputValue(''); 

    const tempId = `local-${Date.now()}`;
    const timestamp = Date.now();
    const optimisticMessage: Message = {
      id: tempId,
      author: {
        id: user?.id || 'guest',
        username: user?.username || 'Guest',
        avatarUrl: user?.avatarUrl || undefined,
        isBot: false,
      },
      content: contentToSend,
      timestamp: new Date(timestamp),
    };

    setMessages(prev => [...prev, optimisticMessage]);

    // Broadcast instantly to LiveKit peers in the room
    const msgKey = `${user?.id || 'guest'}-${timestamp}`;
    seenLiveKitMessages.current.add(msgKey);
    liveKitManager.broadcast({
      type: 'chat',
      text: contentToSend,
      displayName: user?.username || 'Guest',
      peerId: user?.id || 'guest',
      timestamp
    });

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
      
      // Fetch specifically to get the real Discord message ID
      setTimeout(fetchMessages, 500); 
    } catch (error) {
      console.error('Failed to send message:', error);
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
        {isLoading && messages.length === 1 ? (
          <div className="chat-loading">Loading chat...</div>
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
        <div className="chat-input-wrapper">
          <button className="emoji-btn">
            <Smiley size={20} />
          </button>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Message #studio-chat..."
          />
          <button className="send-btn" onClick={handleSendMessage} disabled={!inputValue.trim()}>
            <PaperPlaneRight size={20} weight="fill" />
          </button>
        </div>
      </div>
    </aside>
  );
};