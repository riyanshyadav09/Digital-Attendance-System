import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const storagePath = path.resolve(serverDirectory, "data-store.json");

let data = {
  users: [],
  subjects: [],
  attendance: []
};

const loadData = () => {
  try {
    if (fs.existsSync(storagePath)) {
      const raw = fs.readFileSync(storagePath, "utf-8");
      data = JSON.parse(raw);
      if (!data.users) data.users = [];
      if (!data.subjects) data.subjects = [];
      if (!data.attendance) data.attendance = [];
    }
  } catch (err) {
    console.error("Error loading data-store.json:", err.message);
  }
};

const saveData = () => {
  try {
    fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving data-store.json:", err.message);
  }
};

loadData();

const matchesQuery = (item, query = {}) => {
  for (const [key, val] of Object.entries(query)) {
    if (val && typeof val === "object" && "$in" in val) {
      if (!val.$in.includes(item[key])) return false;
    } else if (item[key] !== val) {
      return false;
    }
  }
  return true;
};

const makeLeanDoc = (doc) => {
  if (!doc) return null;
  const clone = { ...doc };
  if (clone.photoData && typeof clone.photoData === "string" && clone.photoData.startsWith("base64:")) {
    clone.photoData = Buffer.from(clone.photoData.slice(7), "base64");
  }
  return clone;
};

const wrapDoc = (doc, collection) => {
  if (!doc) return null;
  const clone = makeLeanDoc(doc);
  return {
    ...clone,
    toObject() {
      return makeLeanDoc(doc);
    },
    async save() {
      const idx = collection.findIndex((x) => x.id === doc.id);
      if (idx !== -1) {
        collection[idx] = { ...this };
        if (Buffer.isBuffer(collection[idx].photoData)) {
          collection[idx].photoData = "base64:" + collection[idx].photoData.toString("base64");
        }
        saveData();
      }
      return this;
    }
  };
};

const sanitizeForSave = (doc) => {
  const copy = { ...doc };
  if (Buffer.isBuffer(copy.photoData)) {
    copy.photoData = "base64:" + copy.photoData.toString("base64");
  }
  return copy;
};

export const AutoUser = {
  async findOne(query) {
    const item = data.users.find((u) => matchesQuery(u, query));
    if (!item) {
      return {
        lean: () => null,
        select: () => ({ lean: () => null })
      };
    }
    return {
      ...wrapDoc(item, data.users),
      lean: () => makeLeanDoc(item),
      select: () => ({
        lean: () => makeLeanDoc(item)
      })
    };
  },
  async find(query = {}) {
    const list = data.users.filter((u) => matchesQuery(u, query));
    return {
      lean: () => list.map(makeLeanDoc),
      map: (fn) => list.map(makeLeanDoc).map(fn)
    };
  },
  async create(doc) {
    const saved = sanitizeForSave({ ...doc, createdAt: new Date().toISOString() });
    data.users.push(saved);
    saveData();
    return wrapDoc(saved, data.users);
  },
  async findOneAndUpdate(query, changes, _options = {}) {
    const item = data.users.find((u) => matchesQuery(u, query));
    if (!item) return null;
    Object.assign(item, sanitizeForSave(changes), { updatedAt: new Date().toISOString() });
    saveData();
    return wrapDoc(item, data.users);
  },
  async exists(query) {
    return data.users.some((u) => matchesQuery(u, query));
  }
};

export const AutoSubject = {
  async find(query = {}) {
    const list = data.subjects.filter((s) => matchesQuery(s, query));
    return {
      lean: () => list.map(makeLeanDoc),
      then: (resolve) => resolve(list.map(makeLeanDoc))
    };
  },
  async create(doc) {
    const saved = { ...doc, createdAt: new Date().toISOString() };
    data.subjects.push(saved);
    saveData();
    return saved;
  },
  async findOneAndUpdate(query, update, _options = {}) {
    const item = data.subjects.find((s) => matchesQuery(s, query));
    if (!item) return null;
    if (update.$addToSet?.students) {
      item.students = Array.from(new Set([...(item.students || []), update.$addToSet.students]));
    } else {
      Object.assign(item, update);
    }
    item.updatedAt = new Date().toISOString();
    saveData();
    return item;
  },
  async updateOne(query, update) {
    const item = data.subjects.find((s) => matchesQuery(s, query));
    if (!item) return { modifiedCount: 0 };
    if (update.$pull?.students) {
      item.students = (item.students || []).filter((id) => id !== update.$pull.students);
    } else {
      Object.assign(item, update);
    }
    saveData();
    return { modifiedCount: 1 };
  },
  async deleteOne(query) {
    const idx = data.subjects.findIndex((s) => matchesQuery(s, query));
    if (idx === -1) return { deletedCount: 0 };
    data.subjects.splice(idx, 1);
    saveData();
    return { deletedCount: 1 };
  },
  async estimatedDocumentCount() {
    return data.subjects.length;
  },
  async insertMany(docs) {
    data.subjects.push(...docs);
    saveData();
    return docs;
  }
};

export const AutoAttendance = {
  async find(query = {}) {
    const list = data.attendance.filter((a) => matchesQuery(a, query));
    return {
      lean: () => list.map(makeLeanDoc),
      then: (resolve) => resolve(list.map(makeLeanDoc))
    };
  },
  async create(doc) {
    const saved = { ...doc, createdAt: new Date().toISOString() };
    data.attendance.push(saved);
    saveData();
    return saved;
  },
  async findOneAndUpdate(query, update, _options = {}) {
    const item = data.attendance.find((a) => matchesQuery(a, query));
    if (!item) return null;
    Object.assign(item, update, { updatedAt: new Date().toISOString() });
    saveData();
    return item;
  }
};
