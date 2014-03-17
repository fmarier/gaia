/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const CRLF = '\r\n';

/*
 * A logical line MAY be continued on the next physical line anywhere
 * between two characters by inserting a CRLF immediately followed by a
 * single white space character (space, ASCII decimal 32, or horizontal
 * tab, ASCII decimal 9).  At least one character must be present on the
 * folded line. Any sequence of CRLF followed immediately by a single
 * white space character is ignored (removed) when processing the
 * content type.  For example the line:
 *
 * The body of a message is simply lines of US-ASCII characters.  The
 * only two limitations on the body are as follows:
 *
 * o  CR and LF MUST only occur together as CRLF; they MUST NOT appear
 *    independently in the body.
 * o  Lines of characters in the body MUST be limited to 998 characters,
 *    and SHOULD be limited to 78 characters, excluding the CRLF.
 */
function fold(line, maxLength=78) {
  if (maxLength < 20) {
    throw new Error('maxLength should be over 20.  Suggested value is 78');
  }

  // simple and ugly for now
  if (line.length < maxLength) {
    return line;
  }

  var lines = [];
  var usePrefix = false;
  while (line.length > maxLength) {
    var candidate = maxLength;

    // Find a point after punctuation to split on
    while (!line[candidate-1].match(/\W/) && candidate > 1) {
      candidate--;
    }

    // If none found, too bad, it will be ugly.
    if (candidate === 1) {
      candidate = maxLength;
    }

    lines.push(
       usePrefix ?
       ' ' + line.slice(0, candidate) :
       line.slice(0, candidate));
    line = line.slice(candidate);

    if (!usePrefix) {
      usePrefix = true;
      // Adjust line width to compensate for prefix
      maxLength -= 1;
    }
  }
  if (line.length > 0) {
    lines.push(' ' + line);
  }
  return lines.join(CRLF);
}

function unfold(str) {
  // Prefix may be a single space or tab character
  var re = /(\r\n\s)/gm;
  return str.replace(re, '');
}

function esc(str='') {
  var re = /([,])/gm;
  return str.replace(re, '\\$1');
}

// Utility class for composing a line
function Line(name='') {
  this.name = name;
  this.params = [];
  this.value = '';
  return this;
}
Line.prototype = {
  toString: function() {
    if (!this.value) {
      return null;
    }
    var result = fold(
        this.name +
        ((this.params.length) ? ';' + this.params.join(';') : '') +
        ':' +
        this.value);
    return result;
  },

  name: function(string) {
    this.name = string;
    return this;
  },

  param: function(name, value) {
    if (value) {
      this.params.push(name + '=' + value);
    }
    return this;
  },

  type: function(value=[]) {
    // value can be string or list.  For example, mozContact.adr.type is
    // string, but type of email and others is list.

    // XXX do we need to add quotes around type values when there is more than
    // one value, as Perreault does in his example vcard?  I don't see this in
    // the spec anywhere...
    if (typeof value == 'string') {
      this.param('TYPE', value);
    } else {
      this.param('TYPE',
        (value.length > 1) ?
        '\"' + value.join(',') + '\"' :
        value[0]);
    }
    return this;
  },

  pref: function(bool) {
    if (bool) {
      this.param('PREF', '1');
    }
    return this;
  },

  listComponents: function(value) {
    if (typeof value == 'string') {
      this.value = esc(value);
    } else {
      this.value = value.map(function(item) {
        if (!item) {
          return '';
        } if (typeof item == 'string') {
          return esc(item);
        } else {
          // contains a text list
          return item.map(function(x) {
            return esc(x);
          }).join(',');
        }
      }).join(';');
    }
    return this;
  },

  textList: function(value) {
    if (typeof value == 'string') {
      this.value = esc(value);
    } else {
      this.value = value.map(function(item) {
          return esc(item);
      }).join(',');
    }
    return this;
  },

  val: function(value) {
    this.value = esc(value);
    return this;
  },

};

var MozContactTranslator = function MozContactTranslator(mozContactInstance) {
  this.mozContact = mozContactInstance;

  this.fields = [
    'FN',
    'N',
    'NICKNAME',
    'BDAY',
    'ANNIVERSARY',
    'EMAIL',
    'GENDER',
    'ADR',
    'IMPP',
    'TITLE',
    'ORG',
    'NOTE',
    'REV',
    'UID',
    'URL',
    'KEY',
  ];
};

MozContactTranslator.prototype = {
  // Exposed for testing
  fold: fold,

  // Exposed for testing
  unfold: unfold,

  toString: function() {
    var body = this.fields.map(function(field) {
      var property = this[field];
      if (property) {
        if (property.map) {
          return property.map(function(elem) {
            return elem.toString();
          }).join(CRLF);
        }
        return property.toString();
      }
    }).filter(function(value) {
      return (!!value);
    }).join(CRLF);

    return 'BEGIN:VCARD' + CRLF +
           'VERSION:4.0' + CRLF +
           (body ? (body + CRLF) : '') +
           'END:VCARD' + CRLF;
  },

  get FN() {
    // VCard FN: Special notes:  This property is based on the semantics of the
    // X.520 Common Name attribute [CCITT.X520.1988].  The property MUST be
    // present in the vCard object.
    //
    // mozContact.name: The name property is a list of all the possible names
    // use to identify the contact. It's equivalent to the vCard FN
    // attribute.
    //
    // XXX A valid vcard must have both REV and FN - should we throw if there's
    // no FN?
    var name = this.mozContact.name || [];
    return new Line('FN').textList(name);
  },

  get N() {
    // VCard N: Special note:  The structured property value corresponds, in
    // sequence, to the Family Names (also known as surnames), Given Names,
    // Additional Names, Honorific Prefixes, and Honorific Suffixes.  The text
    // components are separated by the SEMICOLON character (U+003B).
    // Individual text components can include multiple text values separated by
    // the COMMA character (U+002C).

    // Add fields in the correct order, as specified by
    // http://contacts-manager-api.sysapps.org/#contactname-interface.  The
    // names of the fields are slightly different as defined in
    // https://developer.mozilla.org/en-US/docs/Web/API/mozContact
    var c = this.mozContact;
    if (! (c.familyName || c.givenName || c.additionalName ||
           c.honorificPrefix || c.honorificSuffix)) {
      return null;
    }

    return new Line('N').listComponents([
               this.mozContact.familyName,
               this.mozContact.givenName,
               this.mozContact.additionalName,
               this.mozContact.honorificPrefix,
               this.mozContact.honorificSuffix,
             ]);
  },

  get NICKNAME() {
    // mozContact nickname is an array of string
    var nickname = this.mozContact.nickname || [];
    return new Line('NICKNAME').textList(nickname);
  },

  get PHOTO() {
    // mozContact.photo is array of Blob, which are photos for the contact.
    //
    // VCard examples:
    //
    //   PHOTO:http://www.example.com/pub/photos/jqpublic.gif
    //
    //   PHOTO:data:image/jpeg;base64,MIICajCCAdOgAwIBAgICBEUwDQYJKoZIhv
    //    AQEEBQAwdzELMAkGA1UEBhMCVVMxLDAqBgNVBAoTI05ldHNjYXBlIENvbW11bm
    //    ljYXRpb25zIENvcnBvcmF0aW9uMRwwGgYDVQQLExNJbmZvcm1hdGlvbiBTeXN0
    //    <...remainder of base64-encoded data...>
    if (this.mozContact.photo) {
      var photo = this.mozContact.photo || [];
      return photo.map(
          function(x) {
            return new Line('PHOTO').val(x);
          });
    }
    return null;
  },

  // mozContact.bday: A Date object representing the birthday date of the
  // contact. This will eventually be converted to a long long timestamp,
  // therefore to stay compatible over time, you should use var bday =
  // +contact.bday to get and use a timestamp in your code.
  get BDAY() {
    if (!this.mozContact.bday) {
      return null;
    }
    // Contacts find() returns an ISO date string, but the MDN docs say we will
    // get a Date object.  Be ready to accept either.
    var maybeDate = this.mozContact.bday;
    return new Line('BDAY')
      .val((typeof maybeDate == 'string') ?
            maybeDate :
            new Date(+maybeDate).toISOString());
  },

  // mozContact.anniversary: A Date object representing the anniversary date of
  // the contact. This will eventually be converted to a long long timestamp,
  // therefore to stay compatible over time, you should use var anniversary =
  // +contact.anniversary to get and use a timestamp in your code.
  get ANNIVERSARY() {
    if (!this.mozContact.anniversary) {
      return null;
    }
    // Contacts find() returns an ISO date string, but the MDN docs say we will
    // get a Date object.  Be ready to accept either.
    var maybeDate = this.mozContact.anniversary;
    return new Line('ANNIVERSARY')
      .val((typeof maybeDate == 'string') ?
            maybeDate :
            new Date(+maybeDate).toISOString());
  },

  // mozContact.genderIdentity: A string representing the gender identity of
  // the contact.
  //
  // According to the working draft, the value will be one of 'male', 'female',
  // 'other', 'none', 'unknown'
  //
  // VCard Sex component:  A single letter.  M stands for 'male', F stands for
  // 'female', O stands for 'other', N stands for 'none or not applicable', U
  // stands for 'unknown'.
  // XXX must we and can we enforce that?
  get GENDER() {
    var c = this.mozContact;
    if (!(c.sex || c.genderIdentity)) {
      return null;
    }
    return new Line('GENDER').listComponents([
        c.sex || '',
        c.genderIdentity || '',
      ]);
  },

  // mozContact.adr: An array of object, each representing an address.
  get ADR() {
    // https://tools.ietf.org/html/rfc6350#page-32 states: "Experience with
    // vCard 3 has shown that the first two components (post office box and
    // extended address) are plagued with many interoperability issues.  To
    // ensure maximal interoperability, their values SHOULD be empty."
    //
    // mozContacts already adheres to this, so we always fill in two empty
    // fields.
    //
    // The order of the fields is given in:
    // http://contacts-manager-api.sysapps.org/#contactaddress-interface
    var adr = this.mozContact.adr || [];
    return adr.map(
        function(x) {
          return new Line('ADR')
            .type(x.type)
            .pref(x.pref)
            .listComponents([
              null,
              null,
              x.streetAddress,
              x.locality,
              x.region,
              x.postalCode,
              x.countryName,
            ]);
        });
  },

  // mozContact.tel: An array of object, each representing a phone number with
  // a few extra metadata. This property can be used for searches, and has
  // special matching criteria.
  get TEL() {
    var tel = this.mozContact.tel || [];
    return tel.map(
        function(x) {
          return new Line('TEL')
            .type(x.type)
            .pref(x.pref)
            .param('CARRIER', x.carrier)
            .val(x.value);
        });
  },

  // mozContact.email: An array of object, each representing an e-mail with a
  // few extra metadata. This property can be used for searches.
  get EMAIL() {
    var email = this.mozContact.email || [];
    return email.map(
        function (x) {
          return new Line('EMAIL')
            .type(x.type)
            .pref(x.pref)
            .val(x.value);
        });
  },

  // mozContact.impp: An array of object, each representing an Instant
  // Messaging address with a few extra metadata.
  get IMPP() {
    var impp = this.mozContact.impp || [];
    return impp.map(
        function(x) {
          return new Line('IMPP')
            .type(x.type)
            .pref(x.pref)
            .val(x.value);
        });
  },

  // No LANG mapping in mozContacts

  // no TZ mapping in mozContacts

  // no GEO mapping in mozContacts

  get TITLE() {
    var jobTitle = this.mozContact.jobTitle || [];
    return jobTitle.map(
      function(x) {
        return new Line('TITLE').val(x);
      }
    );
  },

  // no ROLE mapping in mozContacts

  // no LOGO mapping in mozContacts

  get ORG() {
    var org = this.mozContact.org || [];
    return org.map(
      function(x) {
        return new Line('ORG').val(x);
      }
    );
  },

  // no MEMBER mapping in mozContacts

  // no RELATED mapping in mozContacts

  // mozContact.note: An array of string representing notes about the contact.
  get NOTE() {
    var note = this.mozContact.note || [];
    return note.map(
      function(x) {
        return new Line('NOTE').val(x);
      }
    );
  },

  // XXX PROID? what to do?

  // mozContact.updated (read-only): A Date object giving the last time the
  // contact was updated. This will eventually be converted to a long long
  // timestamp, therefore to stay compatible over time, you should use var
  // updated = +contact.updated to get and use a timestamp in your code.
  get REV() {
    if (!this.mozContact.updated) {
      return null;
    }
    // Contacts find() returns an ISO date string, but the MDN docs say we will
    // get a Date object.  Be ready to accept either.
    var maybeDate = this.mozContact.updated;
    return new Line('REV')
      .val((typeof maybeDate == 'string') ?
            maybeDate :
            new Date(+maybeDate).toISOString());
  },

  // SOUND? Are you kidding me?

  // The unique id of the contact in the device's contact database.
  get UID() {
    // this should always exist, but just in case
    if (!this.mozContact.id) {
      return null;
    }
    // XXX what's the urn:uuid: buisniess? can we do that in Line() ?
    return new Line('UID').val(this.mozContact.id);
  },

  // no CLIENTPIDMAP mapping in mozContacts


  // mozContact.url: An array of object, each representing a URL with a few
  // extra metadata.
  get URL() {
    var url = this.mozContact.url || [];
    return url.map(
        function(x) {
          return new Line('URL')
            .type(x.type)
            .pref(x.pref)
            .val(x.value);
        });
  },

  // mozContact.published: A Date object giving the first time the contact was
  // stored. This will eventually be converted to a long long timestamp,
  // therefore to stay compatible over time, you should use var published =
  // +contact.published to get and use a timestamp in your code.

  // mozContact.key: A array of string representing the public encryption key
  // associated with the contact.
  get KEY() {
    var key = this.mozContact.key || [];
    return key.map(
        function(x) {
          return new Line('KEY').val(x);
        });
  },

  // mozContact.category: An array of string representing the different
  // categories the contact is associated with. This property can be used for
  // searches.
  get CATEGORIES() {
    var categories = this.mozContact.categories || [];
    return new Line('CATEGORIES').textList(categories);
  },
};

