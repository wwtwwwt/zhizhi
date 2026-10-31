export function AutoSaveStatus({status,error}:{status:string;error?:string}) {
  return <div className={`autosave-status ${error?'error':''}`} role="status">{error || (status==='saving'?'保存中…':status==='saved'?'已自动保存':'')}</div>;
}
