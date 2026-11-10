import React, { useMemo, useState } from "react";
import { buildBranchOverview } from "./branch-overview.js";
import "./branch-overview.css";

export function BranchMemberOverview({ organization, clients, passes, instructors, locations, loading, error, onRefresh, onOpenClient, now = new Date() }) {
  const [search, setSearch] = useState("");
  const [locationId, setLocationId] = useState("");
  const [sort, setSort] = useState("name");
  const data = useMemo(() => buildBranchOverview({ viewer: organization, clients, passes: passes || [], instructors, locations, search, locationId, sort, now }), [organization, clients, passes, instructors, locations, search, locationId, sort, now]);
  if (!data.allowed) return <p role="alert">지점 회원 현황은 대표·총괄매니저·FC매니저가 확인할 수 있습니다.</p>;
  if (data.missingScope) return <p role="alert">관리 지점이 지정되지 않았습니다. 대표에게 지점 설정을 요청해 주세요.</p>;
  return <section className="branch-overview" aria-label="지점 회원 현황">
    <div className="bo-heading"><div><h2>강사별 회원 한눈에</h2><p>{loading ? "불러오는 중…" : error ? "조회 확인 필요" : `회원 ${data.count}명 · 회원 선택 시 상세 보기`}</p></div><button type="button" onClick={onRefresh} disabled={loading}>새로고침</button></div>
    <div className="bo-controls">
      <input aria-label="회원 이름, 전화번호, 강사 검색" placeholder="이름 · 전화번호 · 강사 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select aria-label="지점 선택" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">{organization.role === "manager" ? "관리 지점 전체" : "전체 지점"}</option>{data.locations.map((item) => <option key={item.id} value={item.id}>{item.name || "이름 미등록 지점"}</option>)}</select>
      <select aria-label="회원 정렬" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">이름순</option><option value="remaining">잔여 적은 순</option></select>
    </div>
    <p className="bo-note">홀딩 포함 · 만료·취소권 제외 · 공유권은 두 회원에 표시</p>
    {error ? <p role="alert" className="bo-error">현황을 불러오지 못했습니다. 새로고침해 주세요. (코드 {error})</p> : loading ? <p role="status">최신 회원권을 확인하고 있어요…</p> : <>
      {!data.count && <p className="bo-note">{search ? "검색 결과가 없습니다." : "이 지점에 등록된 회원이 없습니다."}</p>}
      <div className="bo-grid">{data.groups.map((teacher) => <section className="bo-group" key={teacher.id || "unassigned"} aria-label={`${teacher.name} 회원`}>
        <h3>{teacher.name}<span>{teacher.rows.length}명</span></h3>
        <div className="bo-columns" aria-hidden="true"><span>회원</span><span>전화번호</span><span>잔여</span></div>
        {teacher.rows.map((row) => <button type="button" className="bo-row" key={row.client.id} onClick={() => onOpenClient?.(row.client)} title={`${row.name} · ${row.phone} · ${row.remaining}회${row.held ? ` (홀딩 ${row.held}회 포함)` : ""}`}>
          <span className="bo-name">{row.name}{row.shared && <small>공유</small>}</span><span className="bo-phone">{row.phone}</span><span className={`bo-count${row.remaining <= 3 ? " bo-low" : ""}`}><b>{row.remaining}</b><small>회</small>{row.held > 0 && <em>홀딩 {row.held}</em>}</span>
        </button>)}
        {!teacher.rows.length && <p className="bo-empty">담당 회원 없음</p>}
      </section>)}</div>
    </>}
  </section>;
}
