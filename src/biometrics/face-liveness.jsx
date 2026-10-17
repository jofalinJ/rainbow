import React from 'react';
import {createRoot} from 'react-dom/client';
import {FaceLivenessDetectorCore} from '@aws-amplify/ui-react-liveness';
import '@aws-amplify/ui-react/styles.css';
import {mountSelfHostedCapture} from './self-hosted-capture.mjs';

// Short-lived StartFaceLivenessSession-only credentials live in this closure, never web storage.
window.RainbowLiveness = {
  mount(container, {kind,sessionId,region,credentials,capture,onComplete,onError,onCancel}) {
    if (kind === 'self_hosted') return mountSelfHostedCapture(container,{sessionId,credentials,capture,onComplete,onError,onCancel});
    const root = createRoot(container);
    let active = true;
    const credentialProvider = async () => {
      if (!active || new Date(credentials.expiration).getTime() <= Date.now()) throw new Error('Liveness credentials expired. Start again.');
      return {accessKeyId:credentials.accessKeyId,secretAccessKey:credentials.secretAccessKey,sessionToken:credentials.sessionToken};
    };
    root.render(<FaceLivenessDetectorCore sessionId={sessionId} region={region}
      onAnalysisComplete={async () => { if (active) await onComplete(); }}
      onError={failure => { if (active) onError({code:failure.state,name:failure.error?.name,message:failure.error?.message}); }}
      onUserCancel={() => { if (active) onCancel?.(); }}
      config={{credentialProvider}} />);
    return () => { active = false; root.unmount(); credentials = null; };
  },
};
