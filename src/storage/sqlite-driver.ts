import Database from 'better-sqlite3';

// The qualified addon reads this setting once, when its native binding is first
// initialized. Application filenames remain validated absolute paths; URI reader
// filenames are constructed internally, with escaped path and fixed parameters.
process.env.SQLITE_USE_URI = '1';
export default Database;
