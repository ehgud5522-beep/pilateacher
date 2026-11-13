import BeforeAfterAlbum from './BeforeAfterAlbum.jsx';

export default function PhotoAccessBoundary({ allowed, ...props }) {
  const photos = Object.fromEntries(Object.entries(props.photos).filter(([id]) => allowed.has(id)));
  // Unmount editor/comparison immediately on a server revocation or network loss.
  if (props.selectedId && !allowed.has(props.selectedId)) return <div className="ba-root"><h1>비포애프터</h1><p>현재 담당 권한을 서버에서 확인할 수 없습니다. 사진은 표시하지 않습니다. 인터넷 연결과 담당 배정을 확인해 주세요.</p><button onClick={() => props.onSelect(null)}>목록으로</button></div>;
  return <BeforeAfterAlbum {...props} members={props.members.filter((m) => allowed.has(m.id))} photos={photos} />;
}
