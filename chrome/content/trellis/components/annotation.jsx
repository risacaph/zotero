/*
    ***** BEGIN LICENSE BLOCK *****

    Copyright © 2021 Corporation for Digital Scholarship
                     Vienna, Virginia, USA
                     https://digitalscholar.org

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

'use strict';

import React, { memo } from 'react';
import ReactDOM from "react-dom";
import PropTypes from 'prop-types';
import cx from 'classnames';

// This is a quick reimplementation of the annotation for use in the conflict resolution window.
// We'll want to replace this with a single component shared between the PDF reader and the rest
// of the codebase.
function AnnotationBox({ data }) {
	var textStyle = {
		borderLeft: "2px solid " + data.color
	};
	
	return (
		<div className="AnnotationBox">
			<div className="title">{Trellis.getString('itemTypes.annotation')}</div>
			<div className="container">
				<div className="header">
					<div>{Trellis.Cite.getLocatorString('page')} {data.pageLabel}</div>
				</div>
				{data.text !== undefined
					? <div className="text" style={textStyle}>{data.text}</div>
					: ''}
				{data.type == 'image'
					// TODO: Localize
					// TODO: Render from PDF based on position, if file is the same? Or don't
					// worry about it?
					? <div className="image-placeholder">[image not shown]</div>
					: ''}
				{data.comment !== undefined
					? <div className="comment">{data.comment}</div>
					: ''}
			</div>
		</div>
	);
}

Trellis.AnnotationBox = memo(AnnotationBox);

Trellis.AnnotationBox.render = (root, props) => {
	root.render(<AnnotationBox { ...props } />);
};
