'use strict';
// Consume Node's test event stream, not human-formatted TAP or log text.
module.exports = async function* (source) {
  for await (const event of source) {
    if (['test:pass','test:fail','test:summary'].includes(event.type)) {
      const d = event.data;
      yield JSON.stringify({type:event.type, data:{name:d.name, file:d.file, line:d.line,
        nesting:d.nesting, skip:d.skip, todo:d.todo, success:d.success, counts:d.counts,
        testType:d.details?.type, failureType:d.details?.error?.failureType, failureMessage:d.details?.error?.cause?.message || d.details?.error?.message}}) + '\n';
    }
  }
};
