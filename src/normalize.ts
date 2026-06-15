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
  isPublic?: boolean;
  isAnnouncementOnly?: boolean;
  lastActivity?: string;
  creatorId?: string;
  created?: string;
  description?: string;
  teamId?: string;
};

export type RawPerson = {
  id?: string;
  displayName?: string;
  emails?: string[];
  firstName?: string;
  lastName?: string;
  avatar?: string;
  status?: string;
  created?: string;
  orgId?: string;
};

export type RawMembership = {
  id?: string;
  roomId?: string;
  personId?: string;
  personEmail?: string;
  isModerator?: boolean;
  isMonitor?: boolean;
  created?: string;
};

export type RawTeam = {
  id?: string;
  name?: string;
  description?: string;
  created?: string;
};

export type RawTeamMembership = {
  id?: string;
  teamId?: string;
  personId?: string;
  personEmail?: string;
  personDisplayName?: string;
  isModerator?: boolean;
  created?: string;
};

export type RawWebhook = {
  id?: string;
  name?: string;
  targetUrl?: string;
  resource?: string;
  event?: string;
  filter?: string;
  secret?: string;
  created?: string;
  status?: string;
};

export type RawAttachmentAction = {
  id?: string;
  messageId?: string;
  type?: string;
  inputs?: Record<string, unknown>;
  personId?: string;
  roomId?: string;
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
    isPublic: s.isPublic,
    isAnnouncementOnly: s.isAnnouncementOnly,
    lastActivity: s.lastActivity,
    creatorId: s.creatorId,
    created: s.created,
    description: s.description,
    teamId: s.teamId,
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
    created: p.created,
    orgId: p.orgId,
  };
}

export function normalizeMembership(m: RawMembership) {
  return {
    id: m.id,
    roomId: m.roomId,
    personId: m.personId,
    personEmail: m.personEmail,
    isModerator: m.isModerator,
    isMonitor: m.isMonitor,
    created: m.created,
  };
}

export function normalizeTeam(t: RawTeam) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    created: t.created,
  };
}

export function normalizeTeamMembership(m: RawTeamMembership) {
  return {
    id: m.id,
    teamId: m.teamId,
    personId: m.personId,
    personEmail: m.personEmail,
    personDisplayName: m.personDisplayName,
    isModerator: m.isModerator,
    created: m.created,
  };
}

export function normalizeWebhook(w: RawWebhook) {
  return {
    id: w.id,
    name: w.name,
    targetUrl: w.targetUrl,
    resource: w.resource,
    event: w.event,
    filter: w.filter,
    created: w.created,
    status: w.status,
  };
}

export function normalizeAttachmentAction(a: RawAttachmentAction) {
  return {
    id: a.id,
    messageId: a.messageId,
    type: a.type,
    inputs: a.inputs,
    personId: a.personId,
    roomId: a.roomId,
    created: a.created,
  };
}
