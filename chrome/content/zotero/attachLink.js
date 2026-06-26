/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2014 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://trellis.org
    
    This file is part of Trellis.
    
    Trellis is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Trellis is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Trellis.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

var Trellis_AttachLink = new function() {
	this.load = function () {
		document.addEventListener('dialogaccept', (event) => {
			if (!this.submit()) {
				event.preventDefault();
			}
		});
	};

	function getAttachFileLabel() {
		return window.opener.document
			.getElementById('trellis-tb-attachment-add-file-link')
			.label;
	};

	this.submit = function() {
		var link = document.getElementById('trellis-attach-uri-input').value;
		var message = document.getElementById('trellis-attach-uri-message');
		var cleanURI = Trellis.Attachments.cleanAttachmentURI(link, true);
		
		if (!cleanURI) {
			message.textContent = Trellis.getString('pane.items.attach.link.uri.unrecognized');
			window.sizeToContent();
			document.getElementById('trellis-attach-uri-input').select();
			return false;
		}
		// Don't allow "file:" links, because using "Attach link to file" is the right way
		else if (cleanURI.toLowerCase().indexOf('file:') == 0) {
			message.textContent = Trellis.getString('pane.items.attach.link.uri.file',
				[getAttachFileLabel()]);
			window.sizeToContent();
			document.getElementById('trellis-attach-uri-input').select();
			return false;
		}
		else {
			window.arguments[0].out = {
				link:	cleanURI,
				title:	document.getElementById('trellis-attach-uri-title').value
			};
			return true;
		}
	};
}