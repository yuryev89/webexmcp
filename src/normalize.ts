export type RawMessage = {
  id?: string;
  roomId?: string;
  personId?: string;
  personEmail?: string;
  text?: string;
  markdown?: string;
  created?: string;
  parentId?: string;
  files?: string[];
};

export type RawSpace = {
  id?: string;
  title?: string;
  type?: string;
  isLocked?: boolean;
  lastActivity?: string;
  creatorId?: string;
  created?: string;
  description?: string;
};

export type RawPerson = {
  id?: string;
  displayName?: string;
  emails?: string[];
  firstName?: string;
  lastName?: string;
  avatar?: string;
  status?: string;
};

export type RawMembership = {
  id?: string;
  roomId?: string;
  personId?: string;
  personEmail?: string;
  isModerator?: boolean;
  created?: string;
};

export function normalizeMessage(m: RawMessage) {
  return {
    id: m.id,
    roomId: m.roomId,
    personEmail: m.personEmail,
    text: m.text,
    markdown: m.markdown,
    created: m.created,
    parentId: m.parentId,
    files: m.files,
  };
}

export function normalizeSpace(s: RawSpace) {
  return {
    id: s.id,
    title: s.title,
    type: s.type,
    isLocked: s.isLocked,
    lastActivity: s.lastActivity,
    creatorId: s.creatorId,
    created: s.created,
  };
}

export function normalizePerson(p: RawPerson) {
  return {
    id: p.id,
    displayName: p.displayName,
    emails: p.emails,
    firstName: p.firstName,
    lastName: p.lastName,
    avatar: p.avatar,
    status: p.status,
  };
}

export function normalizeMembership(m: RawMembership) {
  return {
    id: m.id,
    roomId: m.roomId,
    personId: m.personId,
    personEmail: m.personEmail,
    isModerator: m.isModerator,
    created: m.created,
  };
}
