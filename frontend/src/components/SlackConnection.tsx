import { useCallback, useEffect, useState } from 'react';
import { slackConnectUrl, api } from '../services/api';
import type { SlackChannel, SlackConnection as SlackConnectionState } from '../types';

export function SlackConnection() {
  const [connection, setConnection] = useState<SlackConnectionState | null>(null);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    setChannelError(null);
    try {
      const result = await api.slackChannels();
      setChannels(result.channels);
    } catch (loadError) {
      setChannelError(loadError instanceof Error ? loadError.message : 'Could not load Slack channels.');
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  const loadConnection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.slackConnection();
      setConnection(result);
      if (result.connected) await loadChannels();
      else setChannels([]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not check Slack connection.');
    } finally {
      setLoading(false);
    }
  }, [loadChannels]);

  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  const handleChannelChange = async (channelId: string) => {
    if (!channelId) return;
    setSavingChannel(true);
    setChannelError(null);
    setNotice(null);
    try {
      const result = await api.selectSlackChannel(channelId);
      setConnection(result);
      setNotice('Slack notification channel saved.');
    } catch (saveError) {
      setChannelError(saveError instanceof Error ? saveError.message : 'Could not save the Slack channel.');
    } finally {
      setSavingChannel(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.disconnectSlack();
      setConnection(result);
      setChannels([]);
      setNotice('Slack disconnected.');
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : 'Could not disconnect Slack.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section aria-labelledby="slack-connection-title" className="slack-panel">
      <div className="slack-panel-heading">
        <div className="slack-mark" aria-hidden="true">S</div>
        <div>
          <h2 id="slack-connection-title">Slack</h2>
          <p>Delivery notifications</p>
        </div>
      </div>

      {loading ? (
        <div className="slack-state"><span className="slack-spinner" /> Checking connection</div>
      ) : error ? (
        <div className="slack-state slack-state-error" role="alert">
          <span>{error}</span>
          <button className="slack-text-button" onClick={() => void loadConnection()} type="button">Try again</button>
        </div>
      ) : connection?.connected ? (
        <>
          <div className="slack-connected">
            <div>
              <strong>Connected</strong>
              <span>Workspace {connection.teamId ?? 'available'}</span>
            </div>
            <button className="slack-text-button slack-disconnect" disabled={disconnecting} onClick={() => void handleDisconnect()} type="button">
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>

          <label className="slack-channel-label" htmlFor="slack-channel">Notification channel</label>
          {channelsLoading ? (
            <div className="slack-state"><span className="slack-spinner" /> Loading channels</div>
          ) : channelError ? (
            <div className="slack-state slack-state-error" role="alert">
              <span>{channelError}</span>
              <button className="slack-text-button" onClick={() => void loadChannels()} type="button">Retry</button>
            </div>
          ) : channels.length === 0 ? (
            <p className="slack-muted">No available Slack channels.</p>
          ) : (
            <select
              aria-label="Slack notification channel"
              className="slack-channel-select"
              disabled={savingChannel}
              id="slack-channel"
              onChange={(event) => void handleChannelChange(event.target.value)}
              value={connection.channelId ?? ''}
            >
              <option value="">Select a channel</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{`#${channel.name}${channel.isPrivate ? ' · private' : ''}`}</option>
              ))}
            </select>
          )}
          {notice && <p className="slack-notice" role="status">{notice}</p>}
        </>
      ) : (
        <>
          <p className="slack-muted">Connect a workspace to receive campaign and delivery updates.</p>
          <a className="slack-connect-button" href={slackConnectUrl}>Connect Slack</a>
          {notice && <p className="slack-notice" role="status">{notice}</p>}
        </>
      )}
    </section>
  );
}
