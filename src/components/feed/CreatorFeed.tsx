import { useState, useEffect } from 'react';
import { useToastStore } from '../../state/useToastStore';
import { useUserStore } from '../../state/useUserStore';
import { Fire, ArrowClockwise, WarningCircle, User, X } from '@phosphor-icons/react';
import './CreatorFeed.css';

interface FeedItem {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  creatorName: string;
  creatorAvatarUrl: string | null;
  creatorId: string | null;
  creatorAddress: string | null;
  upvotes: number;
  timestamp: string;
}

export const CreatorFeed = () => {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [upvotedItems, setUpvotedItems] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const { addToast } = useToastStore();
  const { user } = useUserStore();

  const fetchFeed = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/.netlify/functions/fetch-feed');
      if (!response.ok) {
        throw new Error('Failed to fetch feed data');
      }
      const data = await response.json();
      setFeed(data.feed);

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An error occurred while loading the feed.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed();
  }, []);

  const handleUpvote = async (messageId: string) => {
    if (!user) {
      addToast('Please log in to upvote poses.', 'warning');
      return;
    }

    if (upvotedItems.has(messageId)) return; // Prevent double-clicking

    // Optimistic UI update
    setUpvotedItems((prev) => new Set(prev).add(messageId));
    setFeed((prev) => 
      prev.map((item) => 
        item.id === messageId 
          ? { ...item, upvotes: item.upvotes + 1 }
          : item
      )
    );

    try {
      const response = await fetch('/.netlify/functions/upvote-pose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId })
      });

      if (!response.ok) {
        throw new Error('Failed to record upvote');
      }

      useUserStore.getState().recordGamifiedAction('feed_upvote_daily').then(reward => {
        if (reward > 0) {
          useToastStore.getState().addToast(`+${reward} LP for your daily upvote!`, 'info');
        }
      });
    } catch (err) {
      console.error(err);
      // Revert optimistic update on failure
      setUpvotedItems((prev) => {
        const newSet = new Set(prev);
        newSet.delete(messageId);
        return newSet;
      });
      setFeed((prev) => 
        prev.map((item) => 
          item.id === messageId 
            ? { ...item, upvotes: item.upvotes - 1 }
            : item
        )
      );
      addToast('Failed to upvote', 'error');
    }
  };

  const recentPosters = [...new Set(feed.slice(0, 15).map(f => f.creatorName))];
  const tickerText = recentPosters.length > 0 ? `🚀 RECENTS: ${recentPosters.join(' • ')}` : '';

  return (
    <div className="studio-feed-container">
      <div className="studio-feed-header">
        <h2>
          <Fire size={24} weight="fill" color="#FF5E5B" />
          Studio Feed
        </h2>
        <button className="icon-button" onClick={fetchFeed} disabled={isLoading} title="Refresh Feed">
          <ArrowClockwise size={18} className={isLoading ? 'spinning' : ''} />
        </button>
      </div>

      {tickerText && (
        <div className="studio-feed-ticker">
          <div className="ticker-track">
            <span className="ticker-text">{tickerText}</span>
            <span className="ticker-text">{tickerText}</span>
          </div>
        </div>
      )}

      <div className="studio-feed-content">
        {isLoading && feed.length === 0 ? (
          <div className="feed-loading">
             <ArrowClockwise size={32} className="spinning" />
             <p>Loading the latest creations...</p>
          </div>
        ) : error ? (
          <div className="feed-error">
             <WarningCircle size={32} color="var(--danger)" />
             <p>{error}</p>
             <button className="secondary" onClick={fetchFeed}>Try Again</button>
          </div>
        ) : feed.length === 0 ? (
          <div className="feed-empty">
            <p>No creations found.</p>
            <p className="small muted">Be the first to publish something from the Export tab!</p>
          </div>
        ) : (
          feed.map((item) => (
            <div key={item.id} className="feed-item">
              {item.imageUrl && (
                <div 
                  className="feed-item-image" 
                  onClick={() => setSelectedImage(item.imageUrl)}
                  style={{ cursor: 'pointer' }}
                >
                  <img src={item.imageUrl} alt={item.title} loading="lazy" />
                </div>
              )}
              <div className="feed-item-details">
                <div className="feed-item-creator-info">
                  <div className="feed-item-creator-avatar">
                    {item.creatorAvatarUrl ? (
                      <img src={item.creatorAvatarUrl} alt={item.creatorName} />
                    ) : (
                      <User size={16} weight="fill" />
                    )}
                  </div>
                  <div className="feed-item-creator">{item.creatorName}</div>
                </div>
                {item.description && (
                  <div className="feed-item-desc">{item.description}</div>
                )}
                <div className="feed-item-actions">
                  <button 
                    className={`action-btn ${upvotedItems.has(item.id) ? 'upvoted' : ''}`}
                    onClick={() => handleUpvote(item.id)}
                  >
                    <Fire size={18} weight={upvotedItems.has(item.id) ? "fill" : "duotone"} />
                    {item.upvotes}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {selectedImage && (
        <div className="feed-image-modal-overlay" onClick={() => setSelectedImage(null)}>
          <button className="feed-image-modal-close" onClick={() => setSelectedImage(null)}>
            <X size={24} weight="bold" />
          </button>
          <img src={selectedImage} alt="Full view" className="feed-image-modal-content" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
};
