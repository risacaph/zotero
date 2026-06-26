/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
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


Trellis.Timeline = {
	generateXMLDetails: function* (items, dateType) {
		var escapeXML = Trellis.Utilities.htmlSpecialChars;
		
		yield '<data>\n';
		for (let i=0; i<items.length; i++) {
			let item = items[i];
			var date = item.getField(dateType, true, true);
			if (date) {
				let sqlDate = (dateType == 'date') ? Trellis.Date.multipartToSQL(date) : date;
				sqlDate = sqlDate.replace("-00-", "-01-").replace(/-00$/, "-01");
				let content = '<event start="' + Trellis.Date.sqlToDate(sqlDate) + '" ';
				let title = item.getDisplayTitle();
				content += 'title="' + (title ? escapeXML(title) : '') + '" ';
				content += 'icon="' + item.getImageSrc() + '" ';			
				content += 'color="black">';
				content += item.id;
				content += '</event>\n';
				yield content;
			}
		}
		yield '</data>';
	}
};